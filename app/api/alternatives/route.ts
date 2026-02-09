import { NextRequest, NextResponse } from 'next/server'
import { generateGeminiContent, isGeminiConfigured } from '@/lib/ai/gemini'
import {
  MAX_CONTEXT_INPUT_CHARS,
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
      routeKey: 'alternatives',
      preset: 'aiText',
      maxBodyBytes: MAX_TEXT_REQUEST_BYTES,
    })
    if (guardResponse) {
      return guardResponse
    }

    const body = await request.json()
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const context = typeof body?.context === 'string' ? body.context.trim() : ''

    if (!text) {
      console.error('[alternatives API] Missing required field: text')
      return NextResponse.json(
        { error: 'Missing required field: text' },
        { status: 400 }
      )
    }

    const textLimit = enforceTextLimit('text', text, MAX_TEXT_INPUT_CHARS)
    if (textLimit) {
      return textLimit
    }

    if (context) {
      const contextLimit = enforceTextLimit('context', context, MAX_CONTEXT_INPUT_CHARS)
      if (contextLimit) {
        return contextLimit
      }
    }

    if (!isGeminiConfigured()) {
      console.error('[alternatives API] Gemini API keys are not configured')
      return NextResponse.json(
        { error: 'Service not configured' },
        { status: 500 }
      )
    }

    const contextInfo = context ? `Context: ${context}\n` : ''

    // Prompt to get 3 alternatives in one call to save API costs
    // Important: We tell Gemini to respond in the SAME language as the input,
    // not the user's preferred language (that's only for chat translation)
    const prompt = `You are a helpful writing assistant. Given the following sentence, provide exactly 3 alternative ways to express the same idea. Make each alternative:
1. More polished and professional
2. More casual and friendly  
3. More concise and clear

${contextInfo}
Original sentence: "${text}"

IMPORTANT: 
- Respond in the SAME language as the original sentence
- Return ONLY a JSON array with exactly 3 strings, no explanations or additional text
- Format: ["alternative 1", "alternative 2", "alternative 3"]`

    const result = await generateGeminiContent({ request: prompt })
    const response = await result.response
    const responseText = response.text().trim()

    // Parse the JSON response
    let alternatives: string[] = []
    try {
      // Try to extract JSON array from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        alternatives = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON array found in response')
      }
    } catch {
      console.error('[alternatives API] Failed to parse model response as JSON')
      // Fallback: split by newlines and clean up
      alternatives = responseText
        .split('\n')
        .map(line => line.replace(/^[\d\.\-\*]\s*/, '').trim())
        .filter(line => line.length > 0)
        .slice(0, 3)
    }

    // Ensure we have exactly 3 alternatives
    while (alternatives.length < 3) {
      alternatives.push(text) // Fallback to original if we don't have enough
    }
    alternatives = alternatives.slice(0, 3)

    return NextResponse.json({
      original: text,
      alternatives,
    })
  } catch (error) {
    const requestId = createRequestId()
    logServerError('alternatives API', requestId, error)
    return internalServerError('Failed to generate alternatives', requestId)
  }
}
