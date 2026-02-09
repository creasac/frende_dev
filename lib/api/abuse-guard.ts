import { Buffer } from 'node:buffer'
import { NextRequest, NextResponse } from 'next/server'

type TokenBucketConfig = {
  capacity: number
  refillTokensPerSecond: number
}

type RateLimitConfig = {
  ip: TokenBucketConfig
  user: TokenBucketConfig
}

type RateLimitBucket = {
  tokens: number
  lastRefillMs: number
  updatedAtMs: number
}

type RateLimitOutcome = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

type GuardPreset = 'aiText' | 'aiTranscribe'

const ONE_MINUTE_SECONDS = 60
const STALE_BUCKET_TTL_MS = 60 * 60 * 1000

export const MAX_TEXT_REQUEST_BYTES = 32 * 1024
export const MAX_AUDIO_REQUEST_BYTES = 8 * 1024 * 1024

export const MAX_TEXT_INPUT_CHARS = 5000
export const MAX_CONTEXT_INPUT_CHARS = 5000
export const MAX_CHAT_MESSAGE_CHARS = 4000
export const MAX_CHAT_TOTAL_CHARS = 12000
export const MAX_CHAT_MESSAGES = 30
export const MAX_AUDIO_INPUT_BYTES = 5 * 1024 * 1024

const PRESET_RATE_LIMITS: Record<GuardPreset, RateLimitConfig> = {
  aiText: {
    ip: {
      capacity: 20,
      refillTokensPerSecond: 20 / ONE_MINUTE_SECONDS,
    },
    user: {
      capacity: 40,
      refillTokensPerSecond: 40 / ONE_MINUTE_SECONDS,
    },
  },
  aiTranscribe: {
    ip: {
      capacity: 6,
      refillTokensPerSecond: 6 / ONE_MINUTE_SECONDS,
    },
    user: {
      capacity: 12,
      refillTokensPerSecond: 12 / ONE_MINUTE_SECONDS,
    },
  },
}

type GlobalState = typeof globalThis & {
  __frendeRateLimitBuckets?: Map<string, RateLimitBucket>
}

function getBuckets(): Map<string, RateLimitBucket> {
  const globalState = globalThis as GlobalState
  if (!globalState.__frendeRateLimitBuckets) {
    globalState.__frendeRateLimitBuckets = new Map<string, RateLimitBucket>()
  }
  return globalState.__frendeRateLimitBuckets
}

function cleanupStaleBuckets(nowMs: number) {
  const buckets = getBuckets()
  if (buckets.size < 2000) return

  for (const [key, value] of buckets) {
    if (nowMs - value.updatedAtMs > STALE_BUCKET_TTL_MS) {
      buckets.delete(key)
    }
  }
}

function takeToken(bucketKey: string, config: TokenBucketConfig, nowMs: number): RateLimitOutcome {
  const buckets = getBuckets()
  const current = buckets.get(bucketKey)

  if (!current) {
    buckets.set(bucketKey, {
      tokens: Math.max(config.capacity - 1, 0),
      lastRefillMs: nowMs,
      updatedAtMs: nowMs,
    })
    return {
      allowed: true,
      remaining: Math.max(config.capacity - 1, 0),
      retryAfterSeconds: 0,
    }
  }

  const elapsedSeconds = Math.max(0, (nowMs - current.lastRefillMs) / 1000)
  const refilledTokens =
    current.tokens + elapsedSeconds * Math.max(config.refillTokensPerSecond, 0)
  current.tokens = Math.min(config.capacity, refilledTokens)
  current.lastRefillMs = nowMs
  current.updatedAtMs = nowMs

  if (current.tokens >= 1) {
    current.tokens -= 1
    buckets.set(bucketKey, current)
    return {
      allowed: true,
      remaining: Math.floor(current.tokens),
      retryAfterSeconds: 0,
    }
  }

  buckets.set(bucketKey, current)

  const retryAfter =
    config.refillTokensPerSecond > 0
      ? Math.ceil((1 - current.tokens) / config.refillTokensPerSecond)
      : ONE_MINUTE_SECONDS

  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, retryAfter),
  }
}

function decodeBase64Url(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    const paddingLength = (4 - (normalized.length % 4)) % 4
    const padded = `${normalized}${'='.repeat(paddingLength)}`
    return Buffer.from(padded, 'base64').toString('utf8')
  } catch {
    return null
  }
}

function parseJwtSub(token: string): string | null {
  const parts = token.split('.')
  if (parts.length < 2) return null

  const payload = decodeBase64Url(parts[1])
  if (!payload) return null

  try {
    const parsed = JSON.parse(payload) as { sub?: unknown }
    return typeof parsed.sub === 'string' ? parsed.sub : null
  } catch {
    return null
  }
}

function extractTokenFromCookieValue(rawValue: string): string | null {
  const decodedValues: string[] = []

  try {
    decodedValues.push(decodeURIComponent(rawValue))
  } catch {
    decodedValues.push(rawValue)
  }

  for (const decodedValue of [...decodedValues]) {
    if (decodedValue.startsWith('base64-')) {
      const body = decodedValue.slice('base64-'.length)
      try {
        decodedValues.push(Buffer.from(body, 'base64').toString('utf8'))
      } catch {
        // Ignore malformed base64 cookie values.
      }
    }
  }

  for (const candidate of decodedValues) {
    if (candidate.split('.').length === 3) {
      return candidate
    }

    try {
      const parsed = JSON.parse(candidate) as
        | unknown[]
        | {
            access_token?: unknown
            session?: { access_token?: unknown }
            currentSession?: { access_token?: unknown }
          }

      if (Array.isArray(parsed)) {
        const firstJwt = parsed.find(
          (item): item is string =>
            typeof item === 'string' && item.split('.').length === 3
        )
        if (firstJwt) return firstJwt
        continue
      }

      const directToken = parsed.access_token
      if (typeof directToken === 'string') return directToken

      const sessionToken = parsed.session?.access_token
      if (typeof sessionToken === 'string') return sessionToken

      const currentSessionToken = parsed.currentSession?.access_token
      if (typeof currentSessionToken === 'string') return currentSessionToken
    } catch {
      // Ignore non-JSON cookie values.
    }
  }

  return null
}

function extractUserId(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization')
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice('bearer '.length).trim()
    const userIdFromHeader = parseJwtSub(token)
    if (userIdFromHeader) return userIdFromHeader
  }

  for (const cookie of request.cookies.getAll()) {
    if (!cookie.name.includes('auth-token')) continue
    const token = extractTokenFromCookieValue(cookie.value)
    if (!token) continue

    const userIdFromCookie = parseJwtSub(token)
    if (userIdFromCookie) return userIdFromCookie
  }

  return null
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp

  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp

  const requestWithIp = request as NextRequest & { ip?: string }
  if (requestWithIp.ip) return requestWithIp.ip

  return 'unknown'
}

function tooManyRequestsResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    {
      error: 'Too many requests. Please retry later.',
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
      },
    }
  )
}

function payloadTooLargeResponse(message: string): NextResponse {
  return NextResponse.json(
    {
      error: message,
    },
    { status: 413 }
  )
}

export function enforceContentLength(
  request: NextRequest,
  maxBytes: number
): NextResponse | null {
  const contentLengthHeader = request.headers.get('content-length')
  if (!contentLengthHeader) return null

  const contentLength = Number.parseInt(contentLengthHeader, 10)
  if (!Number.isFinite(contentLength) || contentLength <= 0) return null

  if (contentLength > maxBytes) {
    return payloadTooLargeResponse(
      `Payload too large. Maximum request size is ${maxBytes} bytes.`
    )
  }

  return null
}

export function enforceRateLimit(
  request: NextRequest,
  routeKey: string,
  preset: GuardPreset
): NextResponse | null {
  const limits = PRESET_RATE_LIMITS[preset]
  const nowMs = Date.now()
  cleanupStaleBuckets(nowMs)

  const ip = getClientIp(request)
  const ipResult = takeToken(`ip:${routeKey}:${ip}`, limits.ip, nowMs)
  if (!ipResult.allowed) {
    return tooManyRequestsResponse(ipResult.retryAfterSeconds)
  }

  const userId = extractUserId(request)
  if (!userId) return null

  const userResult = takeToken(`user:${routeKey}:${userId}`, limits.user, nowMs)
  if (!userResult.allowed) {
    return tooManyRequestsResponse(userResult.retryAfterSeconds)
  }

  return null
}

export function enforceApiGuards(
  request: NextRequest,
  options: {
    routeKey: string
    preset: GuardPreset
    maxBodyBytes: number
  }
): NextResponse | null {
  const tooLarge = enforceContentLength(request, options.maxBodyBytes)
  if (tooLarge) return tooLarge

  return enforceRateLimit(request, options.routeKey, options.preset)
}

export function enforceTextLimit(
  fieldName: string,
  value: string,
  maxChars: number
): NextResponse | null {
  if (value.length > maxChars) {
    return payloadTooLargeResponse(
      `Payload too large. Maximum ${fieldName} length is ${maxChars} characters.`
    )
  }

  return null
}

export function enforceCharacterCountLimit(
  fieldName: string,
  valueLength: number,
  maxChars: number
): NextResponse | null {
  if (valueLength > maxChars) {
    return payloadTooLargeResponse(
      `Payload too large. Maximum ${fieldName} length is ${maxChars} characters.`
    )
  }

  return null
}

export function enforceArraySizeLimit(
  fieldName: string,
  valueCount: number,
  maxItems: number
): NextResponse | null {
  if (valueCount > maxItems) {
    return payloadTooLargeResponse(
      `Payload too large. Maximum ${fieldName} size is ${maxItems} items.`
    )
  }

  return null
}

export function enforceBlobLimit(
  fieldName: string,
  value: Blob,
  maxBytes: number
): NextResponse | null {
  if (value.size > maxBytes) {
    return payloadTooLargeResponse(
      `Payload too large. Maximum ${fieldName} size is ${maxBytes} bytes.`
    )
  }

  return null
}

export function resetApiRateLimitStoreForTests() {
  getBuckets().clear()
}
