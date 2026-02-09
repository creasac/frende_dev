import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { createClient } from '@/lib/supabase/server'
import { generateGeminiContent, isGeminiConfigured } from '@/lib/ai/gemini'
import { LANGUAGES } from '@/lib/constants/languages'

export const runtime = 'nodejs'

type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced'

type RecipientProfile = {
  id: string
  language_preference?: string | null
  language_proficiency?: ProficiencyLevel | null
  tts_voice?: string | null
  tts_rate?: number | null
}

type MessageRow = {
  id: string
  sender_id: string
  conversation_id: string
  audio_path: string | null
  bypass_recipient_preferences?: boolean
}

type VoiceRenderingWritePayload = {
  message_id: string
  user_id: string
  source_language: string | null
  target_language: string
  target_proficiency: ProficiencyLevel | null
  needs_translation: boolean
  needs_scaling: boolean
  transcript_text: string
  translated_text: string | null
  scaled_text: string | null
  final_text: string
  final_language: string
  final_audio_path: string
  processing_status: 'processing' | 'ready' | 'failed'
  error_message: string | null
  updated_at: string
}

const DEFAULT_VOICE = 'en-US-AriaNeural'

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

const SUPPORTED_LANGUAGE_CODES = new Set(LANGUAGES.map((language) => language.code))
const SUPPORTED_LANGUAGE_NAMES = new Map(
  LANGUAGES.map((language) => [language.name.toLowerCase(), language.code])
)

function normalizeLocale(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

function normalizeLanguage(input: string | null | undefined): string | undefined {
  if (!input) return undefined
  const normalized = normalizeLocale(input)
  if (SUPPORTED_LANGUAGE_CODES.has(normalized)) {
    return normalized
  }
  return SUPPORTED_LANGUAGE_NAMES.get(normalized)
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

function parseScaleResponse(raw: string): string | null {
  const parsed = tryParseJson(raw)
  if (parsed && typeof parsed === 'object') {
    const candidate = parsed as { scaledText?: unknown; scaled_text?: unknown }
    if (typeof candidate.scaledText === 'string') return candidate.scaledText.trim()
    if (typeof candidate.scaled_text === 'string') return candidate.scaled_text.trim()
  }
  return null
}

function isMissingBypassColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { message?: unknown; details?: unknown; hint?: unknown }
  const text = [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()

  return text.includes('bypass_recipient_preferences')
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown; details?: unknown; hint?: unknown }
    const message = [candidate.message, candidate.details, candidate.hint]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' | ')
    if (message) return message
  }
  return 'Unknown error'
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  return (
    candidate.code === '23505' ||
    (typeof candidate.message === 'string' && candidate.message.toLowerCase().includes('duplicate key'))
  )
}

async function writeVoiceRendering(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: VoiceRenderingWritePayload
) {
  const { error: insertError } = await supabase
    .from('message_voice_renderings')
    .insert(payload)

  if (!insertError) {
    return
  }

  if (!isUniqueViolation(insertError)) {
    throw insertError
  }

  const updatePayload: Omit<VoiceRenderingWritePayload, 'message_id' | 'user_id'> = {
    source_language: payload.source_language,
    target_language: payload.target_language,
    target_proficiency: payload.target_proficiency,
    needs_translation: payload.needs_translation,
    needs_scaling: payload.needs_scaling,
    transcript_text: payload.transcript_text,
    translated_text: payload.translated_text,
    scaled_text: payload.scaled_text,
    final_text: payload.final_text,
    final_language: payload.final_language,
    final_audio_path: payload.final_audio_path,
    processing_status: payload.processing_status,
    error_message: payload.error_message,
    updated_at: payload.updated_at,
  }

  const { error: updateError } = await supabase
    .from('message_voice_renderings')
    .update(updatePayload)
    .eq('message_id', payload.message_id)
    .eq('user_id', payload.user_id)

  if (updateError) {
    throw updateError
  }
}

async function transcribeAudio(audio: Blob): Promise<{ text: string; language?: string }> {
  if (!isGeminiConfigured()) {
    throw new Error('Gemini API keys are not configured')
  }

  const mimeType = audio.type || 'audio/webm'
  const arrayBuffer = await audio.arrayBuffer()
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
  const parsed = parseTranscriptionResponse(rawText)
  if (!parsed.text) {
    throw new Error('No speech detected in audio')
  }
  return parsed
}

async function translateText(params: {
  text: string
  sourceLanguage: string
  targetLanguage: string
}): Promise<string> {
  const { text, sourceLanguage, targetLanguage } = params
  if (sourceLanguage === targetLanguage) {
    return text
  }
  if (!isGeminiConfigured()) {
    throw new Error('Gemini API keys are not configured')
  }

  const prompt = `Translate the following text from ${sourceLanguage} to ${targetLanguage}.
Return only the translated text without any explanations.

Text: ${text}`

  const result = await generateGeminiContent({ request: prompt })
  const response = await result.response
  const translated = response.text().trim()
  if (!translated) {
    throw new Error('Translation returned empty text')
  }
  return translated
}

async function scaleText(params: {
  text: string
  targetLevel: ProficiencyLevel
  language: string
}): Promise<string> {
  const { text, targetLevel, language } = params
  if (!isGeminiConfigured()) {
    throw new Error('Gemini API keys are not configured')
  }

  const prompt = `You simplify or enrich text for language learners.
Rewrite the text in ${language} for ${targetLevel} proficiency while preserving meaning.
Return only JSON:
{"scaledText":"..."}

Text: ${text}`

  const result = await generateGeminiContent({ request: prompt })
  const response = await result.response
  const raw = response.text().trim()
  const scaled = parseScaleResponse(raw)
  return scaled && scaled.length > 0 ? scaled : text
}

async function synthesizeSpeech(params: {
  text: string
  language: string
  voice?: string
  rate?: number
}): Promise<Buffer> {
  const { text, language, voice, rate } = params
  const tts = new MsEdgeTTS()
  const selectedVoice = pickVoice(language, toOptionalString(voice))
  const selectedRate = normalizeRate(rate)

  try {
    await tts.setMetadata(selectedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(text, { rate: selectedRate })
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

function buildFinalAudioPath(
  messageId: string,
  senderId: string,
  recipientId: string,
  text: string
): string {
  const shortHash = createHash('sha256').update(text).digest('hex').slice(0, 12)
  return `${senderId}/${messageId}/tts-${recipientId}-${shortHash}.mp3`
}

async function updateMessageStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  messageId: string,
  status: 'processing' | 'ready' | 'failed'
) {
  await supabase
    .from('messages')
    .update({
      processing_status: status,
    })
    .eq('id', messageId)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  let requestedMessageId: string | null = null

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => null)) as
      | {
          messageId?: unknown
        }
      | null

    const messageId = typeof body?.messageId === 'string' ? body.messageId : ''
    requestedMessageId = messageId || null
    if (!messageId) {
      return NextResponse.json({ error: 'Missing messageId' }, { status: 400 })
    }

    const initialMessageResult = await supabase
      .from('messages')
      .select('id, sender_id, conversation_id, audio_path, bypass_recipient_preferences')
      .eq('id', messageId)
      .single()
    let message = initialMessageResult.data as MessageRow | null
    let messageError = initialMessageResult.error

    if (messageError && isMissingBypassColumnError(messageError)) {
      const fallback = await supabase
        .from('messages')
        .select('id, sender_id, conversation_id, audio_path')
        .eq('id', messageId)
        .single()

      message = fallback.data as MessageRow | null
      messageError = fallback.error

      if (message) {
        message.bypass_recipient_preferences = false
      }
    }

    if (messageError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (message.sender_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!message.audio_path) {
      return NextResponse.json({ error: 'Message has no audio_path' }, { status: 400 })
    }
    const sourceAudioPath = message.audio_path

    if (message.bypass_recipient_preferences === true) {
      const { data: recipientPreferenceRows, error: recipientPreferencesError } = await supabase
        .rpc('get_conversation_participant_preferences_secure', { conv_id: message.conversation_id })

      if (recipientPreferencesError) {
        throw recipientPreferencesError
      }

      const recipientProfiles = (recipientPreferenceRows || []) as RecipientProfile[]
      if (recipientProfiles.length === 0) {
        throw new Error('No conversation participants found')
      }

      const perRecipientResults = await Promise.all(recipientProfiles.map(async (profile) => {
        await writeVoiceRendering(supabase, {
          message_id: message.id,
          user_id: profile.id,
          source_language: null,
          target_language: 'und',
          target_proficiency: null,
          needs_translation: false,
          needs_scaling: false,
          transcript_text: '',
          translated_text: null,
          scaled_text: null,
          final_text: '',
          final_language: 'und',
          final_audio_path: sourceAudioPath,
          processing_status: 'ready',
          error_message: null,
          updated_at: new Date().toISOString(),
        })

        return {
          userId: profile.id,
          warnings: [] as string[],
        }
      }))

      await updateMessageStatus(supabase, message.id, 'ready')

      return NextResponse.json({
        ok: true,
        messageId: message.id,
        recipientsProcessed: perRecipientResults.length,
        warnings: 0,
      })
    }

    const { data: sourceAudioBlob, error: sourceAudioError } = await supabase
      .storage
      .from('voice-messages')
      .download(sourceAudioPath)

    if (sourceAudioError || !sourceAudioBlob) {
      throw sourceAudioError || new Error('Failed to download source audio')
    }

    const { text: transcriptText, language: detectedLanguage } = await transcribeAudio(sourceAudioBlob)
    const sourceLanguage = detectedLanguage || 'en'

    const { error: updateMessageError } = await supabase
      .from('messages')
      .update({
        original_text: transcriptText,
        original_language: sourceLanguage,
        processing_status: 'processing',
      })
      .eq('id', message.id)

    if (updateMessageError) {
      throw updateMessageError
    }

    const { data: recipientPreferenceRows, error: recipientPreferencesError } = await supabase
      .rpc('get_conversation_participant_preferences_secure', { conv_id: message.conversation_id })

    if (recipientPreferencesError) {
      throw recipientPreferencesError
    }

    const recipientProfiles = (recipientPreferenceRows || []) as RecipientProfile[]
    if (recipientProfiles.length === 0) {
      throw new Error('No conversation participants found')
    }

    // Sender can already play the original uploaded audio; prioritize recipient renderings.
    const targetProfiles = recipientProfiles.filter((profile) => profile.id !== message.sender_id)
    const profilesToProcess = targetProfiles.length > 0 ? targetProfiles : recipientProfiles
    const perRecipientResults: Array<{ userId: string; warnings: string[] }> = []

    for (const profile of profilesToProcess) {
      const targetLanguage = normalizeLanguage(profile.language_preference || undefined) || sourceLanguage
      const targetProficiency = (profile.language_proficiency || null) as ProficiencyLevel | null
      const shouldTranslate = sourceLanguage !== targetLanguage
      const shouldScale = Boolean(targetProficiency)
      const warnings: string[] = []

      let translatedText: string | null = null
      let scaledText: string | null = null
      let finalText = transcriptText.trim() || transcriptText
      let finalLanguage = sourceLanguage
      let finalAudioPath = sourceAudioPath
      let renderingStatus: 'ready' | 'failed' = 'ready'
      let renderingErrorMessage: string | null = null

      if (shouldTranslate) {
        try {
          translatedText = await translateText({
            text: transcriptText,
            sourceLanguage,
            targetLanguage,
          })
        } catch (error) {
          warnings.push(`Translation skipped: ${errorToMessage(error)}`)
        }
      }

      if (translatedText && translatedText.trim().length > 0) {
        finalText = translatedText.trim()
        finalLanguage = targetLanguage
      }

      if (shouldScale && targetProficiency) {
        try {
          scaledText = await scaleText({
            text: finalText,
            targetLevel: targetProficiency,
            language: finalLanguage,
          })
        } catch (error) {
          warnings.push(`Scaling skipped: ${errorToMessage(error)}`)
        }
      }

      if (scaledText && scaledText.trim().length > 0) {
        finalText = scaledText.trim()
      }

      if (!finalText) {
        finalText = transcriptText
      }

      try {
        const synthesizedAudio = await synthesizeSpeech({
          text: finalText,
          language: finalLanguage,
          voice: profile.tts_voice || undefined,
          rate: profile.tts_rate ?? 0,
        })

        const synthesizedAudioPath = buildFinalAudioPath(
          message.id,
          message.sender_id,
          profile.id,
          finalText
        )
        const synthesizedAudioBody = synthesizedAudio.buffer.slice(
          synthesizedAudio.byteOffset,
          synthesizedAudio.byteOffset + synthesizedAudio.byteLength
        ) as ArrayBuffer
        const { error: uploadError } = await supabase
          .storage
          .from('voice-messages')
          .upload(
            synthesizedAudioPath,
            new Blob([synthesizedAudioBody], { type: 'audio/mpeg' }),
            {
              contentType: 'audio/mpeg',
              upsert: true,
            }
          )

        if (uploadError) {
          throw uploadError
        }

        finalAudioPath = synthesizedAudioPath
      } catch (error) {
        renderingStatus = 'failed'
        const reason = errorToMessage(error)
        warnings.push(`Audio synthesis skipped: ${reason}`)
        renderingErrorMessage = `Audio rendering unavailable: ${reason}`
      }

      await writeVoiceRendering(supabase, {
        message_id: message.id,
        user_id: profile.id,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        target_proficiency: targetProficiency,
        needs_translation: translatedText !== null,
        needs_scaling: scaledText !== null,
        transcript_text: transcriptText,
        translated_text: translatedText,
        scaled_text: scaledText,
        final_text: finalText,
        final_language: finalLanguage,
        final_audio_path: finalAudioPath,
        processing_status: renderingStatus,
        error_message: renderingErrorMessage,
        updated_at: new Date().toISOString(),
      })

      perRecipientResults.push({
        userId: profile.id,
        warnings,
      })
    }

    await updateMessageStatus(supabase, message.id, 'ready')

    const warningCount = perRecipientResults.reduce(
      (count, row) => count + row.warnings.length,
      0
    )

    return NextResponse.json({
      ok: true,
      messageId: message.id,
      recipientsProcessed: perRecipientResults.length,
      warnings: warningCount,
    })
  } catch (error) {
    if (requestedMessageId) {
      await updateMessageStatus(supabase, requestedMessageId, 'failed')
    }

    console.error('[voice finalize API] Failed to finalize voice message:', error)
    return NextResponse.json(
      { error: 'Failed to finalize voice message' },
      { status: 500 }
    )
  }
}
