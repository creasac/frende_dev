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
      routeKey: 'correction',
      preset: 'aiText',
      maxBodyBytes: MAX_TEXT_REQUEST_BYTES,
    })
    if (guardResponse) {
      return guardResponse
    }

    const body = await request.json()
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const feedbackLanguage =
      typeof body?.feedbackLanguage === 'string'
        ? body.feedbackLanguage.trim()
        : undefined

    if (!text) {
      console.error('[correction API] Missing required field: text')
      return NextResponse.json(
        { error: 'Missing required field: text' },
        { status: 400 }
      )
    }

    const textLimit = enforceTextLimit('text', text, MAX_TEXT_INPUT_CHARS)
    if (textLimit) {
      return textLimit
    }

    if (feedbackLanguage) {
      const feedbackLanguageLimit = enforceTextLimit('feedbackLanguage', feedbackLanguage, 32)
      if (feedbackLanguageLimit) {
        return feedbackLanguageLimit
      }
    }

    if (!isGeminiConfigured()) {
      console.error('[correction API] Gemini API keys are not configured')
      return NextResponse.json(
        { error: 'Service not configured' },
        { status: 500 }
      )
    }

    const feedbackLangName = feedbackLanguage ? getLanguageName(feedbackLanguage) : null
    const feedbackInstruction = feedbackLangName
      ? `Write ALL your feedback, explanations, praise, and tips in ${feedbackLangName}.`
      : 'Write your feedback, explanations, praise, and tips in the same language as the input text.'

    // Comprehensive prompt for grammar analysis and corrections
    const prompt = `You are an expert language teacher analyzing a student's sentence. Analyze the following text and provide detailed corrections and suggestions.

Input text: "${text}"

IMPORTANT: ${feedbackInstruction}
The correction should improve the original text while staying in the same language as the input.

Analyze the text and return a JSON object with this EXACT structure:
{
  "correctedSentence": "The fully corrected version of the sentence",
  "overallScore": 85,
  "issues": [
    {
      "type": "grammar|spelling|word_choice|punctuation|style",
      "original": "the incorrect word/phrase",
      "correction": "the corrected version",
      "explanation": "Brief explanation of why this is wrong and how to fix it",
      "position": "beginning|middle|end of sentence"
    }
  ],
  "wordSuggestions": [
    {
      "original": "a word that could be improved",
      "alternatives": ["better option 1", "better option 2"],
      "reason": "Why these alternatives might be better"
    }
  ],
  "praise": "What the student did well (if anything)",
  "tip": "One helpful tip for improvement"
}

Rules:
1. Detect the language automatically and analyze in that language
1b. Do not translate to a different language; keep correctedSentence in the input language
2. If the sentence is perfect, return empty issues array and high score
3. Score from 0-100 based on correctness
4. Be encouraging but honest
5. Focus on the most important issues (max 5)
6. Suggest word alternatives even if grammar is correct (for vocabulary building)
7. Evaluate capitalization and punctuation as part of normal writing quality
8. Return ONLY valid JSON, no markdown or explanations outside the JSON`

    const result = await generateGeminiContent({ request: prompt })
    const response = await result.response
    const responseText = response.text().trim()

    // Parse the JSON response
    let analysis = {
      correctedSentence: text,
      overallScore: 100,
      issues: [],
      wordSuggestions: [],
      praise: '',
      tip: '',
    }

    try {
      // Try to extract JSON object from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        analysis = {
          correctedSentence: parsed.correctedSentence || text,
          overallScore: typeof parsed.overallScore === 'number' ? parsed.overallScore : 100,
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          wordSuggestions: Array.isArray(parsed.wordSuggestions) ? parsed.wordSuggestions : [],
          praise: parsed.praise || '',
          tip: parsed.tip || '',
        }
      } else {
        throw new Error('No JSON object found in response')
      }
    } catch {
      console.error('[correction API] Failed to parse model response as JSON')
      // Return a basic response if parsing fails
      analysis.praise = 'Unable to fully correct. Please try again.'
    }

    return NextResponse.json({
      original: text,
      analysis,
    })
  } catch (error) {
    const requestId = createRequestId()
    logServerError('correction API', requestId, error)
    return internalServerError('Failed to get corrections', requestId)
  }
}
