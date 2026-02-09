import { NextRequest, NextResponse } from 'next/server'
import { getLanguageName } from '@/lib/constants/languages'
import { generateGeminiContent, isGeminiConfigured } from '@/lib/ai/gemini'
import {
  MAX_TEXT_INPUT_CHARS,
  MAX_TEXT_REQUEST_BYTES,
  enforceApiGuards,
  enforceTextLimit,
} from '@/lib/api/abuse-guard'
import {
  createRequestId,
  internalServerError,
  logServerError,
} from '@/lib/api/error-response'

export async function POST(request: NextRequest) {
  try {
    const guardResponse = enforceApiGuards(request, {
      routeKey: 'translate',
      preset: 'aiText',
      maxBodyBytes: MAX_TEXT_REQUEST_BYTES,
    })
    if (guardResponse) {
      return guardResponse
    }

    const body = await request.json()
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const source_lang = typeof body?.source_lang === 'string' ? body.source_lang.trim() : ''
    const target_lang = typeof body?.target_lang === 'string' ? body.target_lang.trim() : ''

    if (!text || !source_lang || !target_lang) {
      console.error('[translate API] Missing required fields')
      return NextResponse.json(
        { error: 'Missing required fields: text, source_lang, target_lang' },
        { status: 400 }
      )
    }

    const textLimit = enforceTextLimit('text', text, MAX_TEXT_INPUT_CHARS)
    if (textLimit) {
      return textLimit
    }

    const sourceLangLimit = enforceTextLimit('source_lang', source_lang, 32)
    if (sourceLangLimit) {
      return sourceLangLimit
    }

    const targetLangLimit = enforceTextLimit('target_lang', target_lang, 32)
    if (targetLangLimit) {
      return targetLangLimit
    }

    // If source and target languages are the same, return original text
    if (source_lang === target_lang) {
      return NextResponse.json({
        translated_text: text,
        source_language: source_lang,
        target_language: target_lang,
      })
    }

    if (!isGeminiConfigured()) {
      console.error('[translate API] Gemini API keys are not configured')
      return NextResponse.json(
        { error: 'Translation service not configured' },
        { status: 500 }
      )
    }

    const sourceLangName = getLanguageName(source_lang)
    const targetLangName = getLanguageName(target_lang)

    // Create a translation prompt
    const prompt = `Translate the following text from ${sourceLangName} to ${targetLangName}. 
Return only the translated text without any explanations, prefixes, or additional text.

Original text (${sourceLangName}): ${text}

Translation (${targetLangName}):`

    const result = await generateGeminiContent({ request: prompt })
    const response = await result.response
    const translatedText = response.text().trim()

    return NextResponse.json({
      translated_text: translatedText,
      source_language: source_lang,
      target_language: target_lang,
    })
  } catch (error) {
    const requestId = createRequestId()
    logServerError('translate API', requestId, error)
    return internalServerError('Translation failed', requestId)
  }
}
