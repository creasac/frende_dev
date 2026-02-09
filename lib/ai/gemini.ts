import {
  GoogleGenerativeAI,
  type GenerateContentResult,
  type GenerativeModel,
  type SingleRequestOptions,
} from '@google/generative-ai'

const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview'
const MAX_GEMINI_ATTEMPTS = 4
const ENV_KEY_NAMES = [
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_1',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
]

type GenerateContentInput = Parameters<GenerativeModel['generateContent']>[0]

type GenerateGeminiContentOptions = {
  request: GenerateContentInput
  model?: string
  requestOptions?: SingleRequestOptions
}

const clientCache = new Map<string, GoogleGenerativeAI>()
let cachedKeys: string[] | null = null

function normalizeKeys(keys: string[]): string[] {
  const uniqueKeys = new Set<string>()
  for (const key of keys) {
    const trimmed = key.trim()
    if (trimmed) {
      uniqueKeys.add(trimmed)
    }
  }
  return Array.from(uniqueKeys)
}

function loadGeminiApiKeys(): string[] {
  if (cachedKeys) {
    return cachedKeys
  }

  const listEnv = process.env.GEMINI_API_KEYS
  if (listEnv) {
    cachedKeys = normalizeKeys(listEnv.split(','))
    return cachedKeys
  }

  const keys = ENV_KEY_NAMES.map(name => process.env[name]).filter(
    (value): value is string => Boolean(value)
  )
  cachedKeys = normalizeKeys(keys)
  return cachedKeys
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const candidate = error as {
    status?: number
    code?: number
    response?: { status?: number }
  }

  return candidate.status ?? candidate.code ?? candidate.response?.status
}

function isRetryableGeminiError(error: unknown): boolean {
  const status = extractErrorStatus(error)
  if (status === 400 || status === 404) {
    return false
  }
  if (status === 401 || status === 403) {
    return true
  }
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
    return true
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('invalid argument') || message.includes('bad request')) {
    return false
  }

  return (
    message.includes('rate') ||
    message.includes('overload') ||
    message.includes('timeout') ||
    message.includes('temporar') ||
    message.includes('unavailable') ||
    message.includes('network') ||
    message.includes('gateway') ||
    message.includes('429') ||
    message.includes('503')
  )
}

export function isGeminiConfigured(): boolean {
  return loadGeminiApiKeys().length > 0
}

function getNextGeminiApiKey(): string {
  const keys = loadGeminiApiKeys()
  if (keys.length === 0) {
    throw new Error('Gemini API keys are not configured')
  }

  const globalState = globalThis as typeof globalThis & { __geminiKeyIndex?: number }
  if (globalState.__geminiKeyIndex === undefined) {
    globalState.__geminiKeyIndex = 0
  }

  const index = globalState.__geminiKeyIndex % keys.length
  globalState.__geminiKeyIndex = (globalState.__geminiKeyIndex + 1) % keys.length
  return keys[index]
}

function getClient(apiKey: string): GoogleGenerativeAI {
  let client = clientCache.get(apiKey)
  if (!client) {
    client = new GoogleGenerativeAI(apiKey)
    clientCache.set(apiKey, client)
  }
  return client
}

export async function generateGeminiContent(
  options: GenerateGeminiContentOptions
): Promise<GenerateContentResult> {
  const keys = loadGeminiApiKeys()
  if (keys.length === 0) {
    throw new Error('Gemini API keys are not configured')
  }

  const modelName = options.model ?? DEFAULT_GEMINI_MODEL
  let lastError: unknown
  const maxAttempts = Math.min(MAX_GEMINI_ATTEMPTS, keys.length)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = getNextGeminiApiKey()
    const client = getClient(apiKey)
    const model = client.getGenerativeModel({ model: modelName })

    try {
      return await model.generateContent(options.request, options.requestOptions)
    } catch (error) {
      lastError = error
      const retryable = isRetryableGeminiError(error)
      console.error('[Gemini] Request failed, attempt:', attempt + 1, 'retryable:', retryable)
      if (!retryable) {
        throw error
      }
      if (attempt < maxAttempts - 1) {
        await sleep(250 * (attempt + 1))
      }
    }
  }

  throw (lastError instanceof Error
    ? lastError
    : new Error('Gemini request failed after maximum retry attempts'))
}
