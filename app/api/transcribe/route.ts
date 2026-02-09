import { NextRequest, NextResponse } from 'next/server'
import { generateGeminiContent, isGeminiConfigured } from '@/lib/ai/gemini'
import { LANGUAGES } from '@/lib/constants/languages'
import {
  MAX_AUDIO_INPUT_BYTES,
  MAX_AUDIO_REQUEST_BYTES,
  enforceApiGuards,
  enforceBlobLimit,
} from '@/lib/api/abuse-guard'
import {
  createRequestId,
  internalServerError,
  logServerError,
} from '@/lib/api/error-response'

const LANGUAGE_CODES = new Set(LANGUAGES.map((language) => language.code))
const LANGUAGE_NAME_TO_CODE = new Map(
  LANGUAGES.map((language) => [language.name.toLowerCase(), language.code])
)

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

function normalizeLanguage(input: string | null | undefined): string | undefined {
  if (!input) return undefined
  const trimmed = input.trim()
  const normalized = trimmed.toLowerCase()
  if (LANGUAGE_CODES.has(normalized)) {
    return normalized
  }
  const byName = LANGUAGE_NAME_TO_CODE.get(normalized)
  return byName || undefined
}

function parseTranscriptionResponse(raw: string): { text: string; language?: string } {
  const parsed = tryParseJson(raw)
  if (parsed && typeof parsed === 'object') {
    const candidate = parsed as { text?: unknown; language?: unknown }
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : ''
    const language =
      typeof candidate.language === 'string'
        ? normalizeLanguage(candidate.language)
        : undefined
    return { text, language }
  }

  return { text: raw.trim() }
}

export async function POST(request: NextRequest) {
  try {
    const guardResponse = enforceApiGuards(request, {
      routeKey: 'transcribe',
      preset: 'aiTranscribe',
      maxBodyBytes: MAX_AUDIO_REQUEST_BYTES,
    })
    if (guardResponse) {
      return guardResponse
    }

    if (!isGeminiConfigured()) {
      console.error('[transcribe API] Gemini API keys are not configured')
      return NextResponse.json({ error: 'Transcription service not configured' }, { status: 500 })
    }

    const formData = await request.formData()
    const file = formData.get('audio')

    if (!file || !(file instanceof Blob)) {
      console.error('[transcribe API] Missing or invalid audio file')
      return NextResponse.json({ error: 'Missing audio file' }, { status: 400 })
    }

    const audioLimit = enforceBlobLimit('audio', file, MAX_AUDIO_INPUT_BYTES)
    if (audioLimit) {
      return audioLimit
    }

    const mimeType = file.type || 'audio/webm'
    const arrayBuffer = await file.arrayBuffer()
    const base64Data = Buffer.from(arrayBuffer).toString('base64')

    const supportedCodes = LANGUAGES.map((language) => language.code).join(', ')
    const instructions = `Transcribe the spoken audio into text in the original language (do not translate).
Detect the spoken language and respond with JSON: {"text":"...","language":"<code>"}.
Use only these language codes: ${supportedCodes}. If unsure, omit language or use "unknown".
Return only JSON with no extra commentary.`

    const result = await generateGeminiContent({
      request: [
        {
          inlineData: {
            data: base64Data,
            mimeType,
          },
        },
        {
          text: instructions,
        },
      ],
    })

    const response = await result.response
    const rawText = response.text().trim()
    const { text, language } = parseTranscriptionResponse(rawText)

    return NextResponse.json({
      text,
      language,
    })
  } catch (error) {
    const requestId = createRequestId()
    logServerError('transcribe API', requestId, error)
    return internalServerError('Transcription failed', requestId)
  }
}
