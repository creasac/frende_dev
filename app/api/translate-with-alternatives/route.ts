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
      routeKey: 'translate-with-alternatives',
      preset: 'aiText',
      maxBodyBytes: MAX_TEXT_REQUEST_BYTES,
    })
    if (guardResponse) {
      return guardResponse
    }

    const body = await request.json()
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const targetLanguage =
      typeof body?.targetLanguage === 'string' ? body.targetLanguage.trim() : ''

    if (!text) {
      console.error('[translate-alt API] Missing required field: text')
      return NextResponse.json(
        { error: 'Missing required field: text' },
        { status: 400 }
      )
    }

    if (!targetLanguage) {
      console.error('[translate-alt API] Missing required field: targetLanguage')
      return NextResponse.json(
        { error: 'Missing required field: targetLanguage' },
        { status: 400 }
      )
    }

    const textLimit = enforceTextLimit('text', text, MAX_TEXT_INPUT_CHARS)
    if (textLimit) {
      return textLimit
    }

    const targetLanguageLimit = enforceTextLimit('targetLanguage', targetLanguage, 32)
    if (targetLanguageLimit) {
      return targetLanguageLimit
    }

    if (!isGeminiConfigured()) {
      console.error('[translate-alt API] Gemini API keys are not configured')
      return NextResponse.json(
        { error: 'Service not configured' },
        { status: 500 }
      )
    }

    const targetLangName = getLanguageName(targetLanguage)

    // Prompt to get translation + 2 alternatives in one call to save API costs
    const prompt = `You are a professional translator. Translate the following text to ${targetLangName} and provide alternatives.

Original text: "${text}"

Provide exactly 3 translations:
1. Direct translation - accurate and natural translation
2. Formal version - more polished and professional tone
3. Casual version - more friendly and conversational tone

IMPORTANT: 
- Translate to ${targetLangName}
- Return ONLY a JSON object with this exact format, no explanations:
{"direct": "translation 1", "formal": "translation 2", "casual": "translation 3"}`

    const result = await generateGeminiContent({ request: prompt })
    const response = await result.response
    const responseText = response.text().trim()

    // Parse the JSON response
    let translations = {
      direct: '',
      formal: '',
      casual: '',
    }

    try {
      // Try to extract JSON object from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        translations = {
          direct: parsed.direct || '',
          formal: parsed.formal || '',
          casual: parsed.casual || '',
        }
      } else {
        throw new Error('No JSON object found in response')
      }
    } catch {
      console.error('[translate-alt API] Failed to parse model response as JSON')
      // Fallback: use the raw response as direct translation
      translations.direct = responseText
      translations.formal = responseText
      translations.casual = responseText
    }

    return NextResponse.json({
      original: text,
      targetLanguage,
      translations,
    })
  } catch (error) {
    const requestId = createRequestId()
    logServerError('translate-alt API', requestId, error)
    return internalServerError('Failed to translate', requestId)
  }
}
