import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_TEXT_LENGTH = 2000
const MAX_CACHE_ENTRIES = 200
const CACHE_TTL_MS = 1000 * 60 * 30
const FILE_CACHE_DIR = '/tmp/frende_tts_cache'
const ENABLE_FILE_CACHE = process.env.NODE_ENV !== 'test'
const DEFAULT_VOICE = 'en-US-AriaNeural'

type CacheEntry = {
  audio: Buffer
  expiresAt: number
}

const ttsAudioCache = new Map<string, CacheEntry>()
const inFlightSyntheses = new Map<string, Promise<Buffer>>()
let ensureFileCacheDirPromise: Promise<void> | null = null

const DEFAULT_VOICE_BY_LANGUAGE: Record<string, string> = {
  ar: 'ar-SA-ZariyahNeural',
  de: 'de-DE-KatjaNeural',
  en: 'en-US-AriaNeural',
  es: 'es-ES-ElviraNeural',
  fr: 'fr-FR-DeniseNeural',
  hi: 'hi-IN-SwaraNeural',
  it: 'it-IT-ElsaNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  nl: 'nl-NL-ColetteNeural',
  pl: 'pl-PL-ZofiaNeural',
  pt: 'pt-BR-FranciscaNeural',
  ru: 'ru-RU-SvetlanaNeural',
  sv: 'sv-SE-SofieNeural',
  tr: 'tr-TR-EmelNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
}

function normalizeLocale(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function pickVoice(language: string | undefined, requestedVoice: string | undefined): string {
  if (requestedVoice) {
    return requestedVoice
  }

  if (language) {
    const normalized = normalizeLocale(language)
    const localeVoice = DEFAULT_VOICE_BY_LANGUAGE[normalized]
    if (localeVoice) {
      return localeVoice
    }

    const languageCode = normalized.split('-')[0]
    const languageVoice = DEFAULT_VOICE_BY_LANGUAGE[languageCode]
    if (languageVoice) {
      return languageVoice
    }
  }

  return DEFAULT_VOICE
}

function normalizeRate(value: unknown): string {
  let numericValue = 0

  if (typeof value === 'number' && Number.isFinite(value)) {
    numericValue = value
  } else if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      numericValue = parsed
    }
  }

  const clamped = Math.max(-50, Math.min(50, Math.round(numericValue)))
  return `${clamped >= 0 ? '+' : ''}${clamped}%`
}

function buildCacheKey(text: string, voice: string, rate: string): string {
  return createHash('sha256')
    .update(`${voice}|${rate}|${text}`)
    .digest('hex')
}

function pruneExpiredCache(now = Date.now()) {
  for (const [key, entry] of ttsAudioCache.entries()) {
    if (entry.expiresAt <= now) {
      ttsAudioCache.delete(key)
    }
  }
}

function getCachedAudio(cacheKey: string): Buffer | null {
  const entry = ttsAudioCache.get(cacheKey)
  if (!entry) return null

  if (entry.expiresAt <= Date.now()) {
    ttsAudioCache.delete(cacheKey)
    return null
  }

  // Refresh recency for simple LRU behavior.
  ttsAudioCache.delete(cacheKey)
  ttsAudioCache.set(cacheKey, entry)

  return entry.audio
}

function setCachedAudio(cacheKey: string, audio: Buffer) {
  const now = Date.now()
  pruneExpiredCache(now)

  ttsAudioCache.set(cacheKey, {
    audio,
    expiresAt: now + CACHE_TTL_MS,
  })

  while (ttsAudioCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = ttsAudioCache.keys().next().value
    if (!oldestKey) break
    ttsAudioCache.delete(oldestKey)
  }
}

function ensureFileCacheDir() {
  if (!ensureFileCacheDirPromise) {
    ensureFileCacheDirPromise = mkdir(FILE_CACHE_DIR, { recursive: true }).then(() => undefined)
  }
  return ensureFileCacheDirPromise
}

function buildFileCachePath(cacheKey: string) {
  return path.join(FILE_CACHE_DIR, `${cacheKey}.mp3`)
}

function toResponseBody(audio: Buffer): ArrayBuffer {
  return audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength
  ) as ArrayBuffer
}

async function getFileCachedAudio(cacheKey: string): Promise<Buffer | null> {
  try {
    await ensureFileCacheDir()
    const filePath = buildFileCachePath(cacheKey)
    const fileStats = await stat(filePath)

    if (Date.now() - fileStats.mtimeMs > CACHE_TTL_MS) {
      await unlink(filePath).catch(() => undefined)
      return null
    }

    return await readFile(filePath)
  } catch {
    return null
  }
}

async function setFileCachedAudio(cacheKey: string, audio: Buffer): Promise<void> {
  try {
    await ensureFileCacheDir()
    const filePath = buildFileCachePath(cacheKey)
    await writeFile(filePath, audio)
  } catch (error) {
    console.error('[tts API] Failed to write file cache:', error)
  }
}

async function synthesizeAudioBuffer({
  text,
  voice,
  rate,
}: {
  text: string
  voice: string
  rate: string
}): Promise<Buffer> {
  const tts = new MsEdgeTTS()

  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(text, { rate })
    const chunks: Buffer[] = []

    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const audioBuffer = Buffer.concat(chunks)
    if (audioBuffer.length === 0) {
      throw new Error('Generated TTS audio is empty')
    }

    return audioBuffer
  } finally {
    tts.close()
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => null)) as
      | {
          text?: unknown
          language?: unknown
          voice?: unknown
          rate?: unknown
        }
      | null

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 })
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Text is too long (max ${MAX_TEXT_LENGTH} characters)` },
        { status: 400 }
      )
    }

    const selectedVoice = pickVoice(
      toOptionalString(body.language),
      toOptionalString(body.voice)
    )
    const selectedRate = normalizeRate(body.rate)
    const cacheKey = buildCacheKey(text, selectedVoice, selectedRate)
    const cachedAudio = getCachedAudio(cacheKey)

    if (cachedAudio) {
      return new Response(toResponseBody(cachedAudio), {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'private, max-age=86400',
          'X-TTS-Cache': 'HIT',
        },
      })
    }

    if (ENABLE_FILE_CACHE) {
      const fileCachedAudio = await getFileCachedAudio(cacheKey)
      if (fileCachedAudio) {
        setCachedAudio(cacheKey, fileCachedAudio)
        return new Response(toResponseBody(fileCachedAudio), {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'private, max-age=86400',
            'X-TTS-Cache': 'HIT',
          },
        })
      }
    }

    const existingInFlight = inFlightSyntheses.get(cacheKey)
    if (existingInFlight) {
      const inFlightAudio = await existingInFlight
      setCachedAudio(cacheKey, inFlightAudio)
      return new Response(toResponseBody(inFlightAudio), {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'private, max-age=86400',
          'X-TTS-Cache': 'HIT',
        },
      })
    }

    const synthesisPromise = synthesizeAudioBuffer({
      text,
      voice: selectedVoice,
      rate: selectedRate,
    })

    inFlightSyntheses.set(cacheKey, synthesisPromise)

    const audioBuffer = await synthesisPromise.finally(() => {
      inFlightSyntheses.delete(cacheKey)
    })

    setCachedAudio(cacheKey, audioBuffer)
    if (ENABLE_FILE_CACHE) {
      void setFileCachedAudio(cacheKey, audioBuffer)
    }

    return new Response(toResponseBody(audioBuffer), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=86400',
        'X-TTS-Cache': 'MISS',
      },
    })
  } catch (error) {
    console.error('[tts API] Failed to synthesize speech:', error)
    return NextResponse.json(
      { error: 'Failed to synthesize speech' },
      { status: 500 }
    )
  }
}
