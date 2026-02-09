import { NextRequest, NextResponse } from 'next/server'
import { generateGeminiContent, isGeminiConfigured } from '@/lib/ai/gemini'
import {
  MAX_TEXT_INPUT_CHARS,
  MAX_TEXT_REQUEST_BYTES,
  enforceApiGuards,
  enforceTextLimit,
} from '@/lib/api/abuse-guard'

export type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced'

export async function POST(request: NextRequest) {
  let text: string = ''
  let targetLevel: string = ''
  
  try {
    const guardResponse = enforceApiGuards(request, {
      routeKey: 'scale',
      preset: 'aiText',
      maxBodyBytes: MAX_TEXT_REQUEST_BYTES,
    })
    if (guardResponse) {
      return guardResponse
    }

    const body = await request.json()
    text = typeof body?.text === 'string' ? body.text.trim() : ''
    targetLevel =
      typeof body?.targetLevel === 'string' ? body.targetLevel.trim().toLowerCase() : ''
    const language = typeof body?.language === 'string' ? body.language.trim() : ''

    if (!text) {
      console.error('[scale API] Missing required field: text')
      return NextResponse.json(
        { error: 'Missing required field: text' },
        { status: 400 }
      )
    }

    const textLimit = enforceTextLimit('text', text, MAX_TEXT_INPUT_CHARS)
    if (textLimit) {
      return textLimit
    }

    if (language) {
      const languageLimit = enforceTextLimit('language', language, 32)
      if (languageLimit) {
        return languageLimit
      }
    }

    if (!targetLevel || !['beginner', 'intermediate', 'advanced'].includes(targetLevel)) {
      console.error('[scale API] Invalid target level:', targetLevel)
      return NextResponse.json(
        { error: 'Invalid target level. Must be beginner, intermediate, or advanced' },
        { status: 400 }
      )
    }

    if (!isGeminiConfigured()) {
      console.error('[scale API] Gemini API keys are not configured')
      return NextResponse.json(
        { error: 'Service not configured' },
        { status: 500 }
      )
    }

    const languageInfo = language ? `The text is in ${language}.` : 'Detect the language of the text.'
    
    const levelDescriptions = {
      beginner: 'A1-A2 level: Use very simple vocabulary, short sentences, basic grammar, common everyday words. Avoid idioms, complex structures, and advanced vocabulary.',
      intermediate: 'B1-B2 level: Use moderately complex vocabulary, varied sentence structures, some idiomatic expressions. Balance between simplicity and natural expression.',
      advanced: 'C1-C2 level: Use sophisticated vocabulary, complex sentence structures, idiomatic expressions, nuanced language. Maintain natural, fluent expression.'
    }

    const prompt = `You are a language complexity scaler for language learners. Your task is to rewrite the given text to match a specific proficiency level while preserving the EXACT meaning, tone, and intent.

${languageInfo}

Target proficiency level: ${targetLevel.toUpperCase()}
Level description: ${levelDescriptions[targetLevel as ProficiencyLevel]}

Original text: "${text}"

IMPORTANT RULES:
1. Preserve the EXACT meaning - do not add, remove, or change any information
2. Keep the same tone (formal/informal, friendly/professional)
3. Keep the same intent and emotional context
4. Respond in the SAME language as the input text
5. If the text is already at the target level, return it unchanged or with minimal adjustments
6. For beginner level: break complex sentences into shorter ones, replace difficult words with simpler synonyms
7. For intermediate level: balance complexity, use common idiomatic expressions
8. For advanced level: use more sophisticated vocabulary and complex structures where natural

Return ONLY a JSON object with these fields:
{
  "scaledText": "the rewritten text at target level",
  "originalLevel": "beginner|intermediate|advanced (estimated level of original)",
  "wasScaled": true/false (whether significant changes were made),
  "changes": ["brief description of key changes made, or empty array if no changes"]
}

Return ONLY the JSON object, no additional text or explanation.`

    const result = await generateGeminiContent({ request: prompt })
    const response = await result.response
    const responseText = response.text().trim()

    // Parse the JSON response
    let parsedResponse
    try {
      // Try to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON object found in response')
      }
    } catch {
      console.error('[scale API] Failed to parse model response as JSON')
      // Fallback: return original text as scaled
      parsedResponse = {
        scaledText: text,
        originalLevel: 'unknown',
        wasScaled: false,
        changes: []
      }
    }

    // Ensure required fields exist
    const finalResponse = {
      original: text,
      scaledText: parsedResponse.scaledText || text,
      targetLevel,
      originalLevel: parsedResponse.originalLevel || 'unknown',
      wasScaled: parsedResponse.wasScaled ?? false,
      changes: parsedResponse.changes || []
    }

    return NextResponse.json(finalResponse)
  } catch (error) {
    console.error('[scale API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to scale text complexity' },
      { status: 500 }
    )
  }
}
