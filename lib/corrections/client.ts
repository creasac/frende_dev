import { createClient } from '@/lib/supabase/client'
import { postJsonWithRetry } from '@/lib/ai/apiRequestQueue'
import { LANGUAGES } from '@/lib/constants/languages'
import {
  type AiChatMessageCorrection,
  type CorrectionAnalysis,
  type CorrectionIssue,
  type CorrectionIssueType,
  type CorrectionWordSuggestion,
  type FocusedCorrectionPayload,
  type MessageCorrection,
} from '@/types/correction'

const MESSAGE_CORRECTION_SELECT =
  'id,message_id,user_id,feedback_language,original_text,corrected_sentence,overall_score,issues,word_suggestions,praise,tip,has_issues,created_at,updated_at'
const AI_MESSAGE_CORRECTION_SELECT =
  'id,ai_message_id,user_id,feedback_language,original_text,corrected_sentence,overall_score,issues,word_suggestions,praise,tip,has_issues,created_at,updated_at'

const ISSUE_TYPES: Set<CorrectionIssueType> = new Set([
  'grammar',
  'spelling',
  'word_choice',
  'punctuation',
  'style',
])
const LANGUAGE_CODES = new Set(LANGUAGES.map((language) => language.code))
const LANGUAGE_NAME_TO_CODE = new Map(
  LANGUAGES.map((language) => [language.name.toLowerCase(), language.code] as const)
)

export const PLAYGROUND_CORRECTION_FOCUS_KEY = 'playgroundCorrectionFocus'

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeIssueType(value: unknown): CorrectionIssueType {
  if (typeof value !== 'string') return 'style'
  return ISSUE_TYPES.has(value as CorrectionIssueType)
    ? (value as CorrectionIssueType)
    : 'style'
}

function normalizeScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 100
  }

  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeFeedbackLanguageCode(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/_/g, '-')
  if (!normalized) return undefined

  if (LANGUAGE_CODES.has(normalized)) {
    return normalized
  }

  const byName = LANGUAGE_NAME_TO_CODE.get(normalized)
  if (byName) {
    return byName
  }

  const base = normalized.split('-')[0]
  if (LANGUAGE_CODES.has(base)) {
    return base
  }

  return undefined
}

function normalizeIssues(value: unknown): CorrectionIssue[] {
  if (!Array.isArray(value)) return []

  return value.reduce<CorrectionIssue[]>((acc, current) => {
    if (!current || typeof current !== 'object') {
      return acc
    }

    const issue = current as Record<string, unknown>
    const original = toTrimmedString(issue.original)
    const correction = toTrimmedString(issue.correction)
    const explanation = toTrimmedString(issue.explanation)

    if (!original && !correction && !explanation) {
      return acc
    }

    acc.push({
      type: normalizeIssueType(issue.type),
      original,
      correction,
      explanation,
      position: toTrimmedString(issue.position),
    })

    return acc
  }, [])
}

function normalizeWordSuggestions(value: unknown): CorrectionWordSuggestion[] {
  if (!Array.isArray(value)) return []

  return value.reduce<CorrectionWordSuggestion[]>((acc, current) => {
    if (!current || typeof current !== 'object') {
      return acc
    }

    const suggestion = current as Record<string, unknown>
    const original = toTrimmedString(suggestion.original)
    const alternatives = Array.isArray(suggestion.alternatives)
      ? suggestion.alternatives
          .map((item) => toTrimmedString(item))
          .filter((item) => item.length > 0)
      : []
    const reason = toTrimmedString(suggestion.reason)

    if (!original && alternatives.length === 0 && !reason) {
      return acc
    }

    acc.push({
      original,
      alternatives,
      reason,
    })

    return acc
  }, [])
}

function fallbackAnalysis(text: string): CorrectionAnalysis {
  return {
    correctedSentence: text,
    overallScore: 100,
    issues: [],
    wordSuggestions: [],
    praise: '',
    tip: '',
  }
}

export function normalizeCorrectionAnalysis(
  raw: unknown,
  originalText: string
): CorrectionAnalysis {
  if (!raw || typeof raw !== 'object') {
    return fallbackAnalysis(originalText)
  }

  const value = raw as Record<string, unknown>
  const correctedSentence =
    toTrimmedString(value.correctedSentence) ||
    toTrimmedString(value.corrected_sentence) ||
    originalText

  return {
    correctedSentence,
    overallScore: normalizeScore(value.overallScore ?? value.overall_score),
    issues: normalizeIssues(value.issues),
    wordSuggestions: normalizeWordSuggestions(
      value.wordSuggestions ?? value.word_suggestions
    ),
    praise: toTrimmedString(value.praise),
    tip: toTrimmedString(value.tip),
  }
}

export function hasCorrectionIssues(
  analysis: CorrectionAnalysis,
  originalText: string
): boolean {
  if (analysis.issues.length > 0) {
    return true
  }

  const normalizedOriginal = originalText.trim()
  const normalizedCorrected = analysis.correctedSentence.trim()
  return normalizedOriginal.length > 0 && normalizedCorrected !== normalizedOriginal
}

export async function requestCorrectionAnalysis(params: {
  text: string
  feedbackLanguage?: string | null
  source: string
}): Promise<CorrectionAnalysis> {
  const text = params.text.trim()
  if (!text) {
    return fallbackAnalysis('')
  }

  const feedbackLanguage = normalizeFeedbackLanguageCode(params.feedbackLanguage || undefined)

  const data = await postJsonWithRetry<{ analysis?: unknown }>(
    '/api/correction',
    {
      text,
      feedbackLanguage,
    },
    { source: params.source, persist: true }
  )

  return normalizeCorrectionAnalysis(data.analysis, text)
}

function buildStoredPayload(params: {
  userId: string
  feedbackLanguage: string
  originalText: string
  analysis: CorrectionAnalysis
}) {
  const { userId, feedbackLanguage, originalText, analysis } = params
  const normalizedFeedbackLanguage = normalizeFeedbackLanguageCode(feedbackLanguage) || 'en'
  return {
    user_id: userId,
    feedback_language: normalizedFeedbackLanguage,
    original_text: originalText,
    corrected_sentence: analysis.correctedSentence,
    overall_score: normalizeScore(analysis.overallScore),
    issues: analysis.issues,
    word_suggestions: analysis.wordSuggestions,
    praise: analysis.praise || null,
    tip: analysis.tip || null,
    has_issues: hasCorrectionIssues(analysis, originalText),
    updated_at: new Date().toISOString(),
  }
}

export async function upsertMessageCorrection(params: {
  messageId: string
  userId: string
  text: string
  feedbackLanguage: string
  source: string
}): Promise<MessageCorrection | null> {
  const originalText = params.text.trim()
  if (!originalText) return null

  const analysis = await requestCorrectionAnalysis({
    text: originalText,
    // Let model detect the message language and correct in-place for persisted chat flows.
    feedbackLanguage: undefined,
    source: params.source,
  })

  const supabase = createClient()
  const payload = {
    message_id: params.messageId,
    ...buildStoredPayload({
      userId: params.userId,
      feedbackLanguage: params.feedbackLanguage,
      originalText,
      analysis,
    }),
  }

  const { data, error } = await supabase
    .from('message_corrections')
    .upsert(payload, { onConflict: 'message_id,user_id' })
    .select(MESSAGE_CORRECTION_SELECT)
    .single()

  if (error || !data) {
    throw error || new Error('Failed to save message correction')
  }

  return data as MessageCorrection
}

export async function upsertAiMessageCorrection(params: {
  aiMessageId: string
  userId: string
  text: string
  feedbackLanguage: string
  source: string
}): Promise<AiChatMessageCorrection | null> {
  const originalText = params.text.trim()
  if (!originalText) return null

  const analysis = await requestCorrectionAnalysis({
    text: originalText,
    // Let model detect the message language and correct in-place for persisted AI chat flows.
    feedbackLanguage: undefined,
    source: params.source,
  })

  const supabase = createClient()
  const payload = {
    ai_message_id: params.aiMessageId,
    ...buildStoredPayload({
      userId: params.userId,
      feedbackLanguage: params.feedbackLanguage,
      originalText,
      analysis,
    }),
  }

  const { data, error } = await supabase
    .from('ai_chat_message_corrections')
    .upsert(payload, { onConflict: 'ai_message_id,user_id' })
    .select(AI_MESSAGE_CORRECTION_SELECT)
    .single()

  if (error || !data) {
    throw error || new Error('Failed to save AI message correction')
  }

  return data as AiChatMessageCorrection
}

export async function fetchMessageCorrections(params: {
  messageIds: string[]
  userId: string
}): Promise<Record<string, MessageCorrection>> {
  if (params.messageIds.length === 0) return {}

  const supabase = createClient()
  const { data, error } = await supabase
    .from('message_corrections')
    .select(MESSAGE_CORRECTION_SELECT)
    .eq('user_id', params.userId)
    .in('message_id', params.messageIds)

  if (error || !data) {
    throw error || new Error('Failed to fetch message corrections')
  }

  return (data as MessageCorrection[]).reduce<Record<string, MessageCorrection>>(
    (acc, row) => {
      acc[row.message_id] = row
      return acc
    },
    {}
  )
}

export async function fetchAiMessageCorrections(params: {
  aiMessageIds: string[]
  userId: string
}): Promise<Record<string, AiChatMessageCorrection>> {
  if (params.aiMessageIds.length === 0) return {}

  const supabase = createClient()
  const { data, error } = await supabase
    .from('ai_chat_message_corrections')
    .select(AI_MESSAGE_CORRECTION_SELECT)
    .eq('user_id', params.userId)
    .in('ai_message_id', params.aiMessageIds)

  if (error || !data) {
    throw error || new Error('Failed to fetch AI message corrections')
  }

  return (data as AiChatMessageCorrection[]).reduce<
    Record<string, AiChatMessageCorrection>
  >((acc, row) => {
    acc[row.ai_message_id] = row
    return acc
  }, {})
}

export function analysisFromStoredCorrection(
  correction:
    | Pick<
        MessageCorrection,
        | 'original_text'
        | 'corrected_sentence'
        | 'overall_score'
        | 'issues'
        | 'word_suggestions'
        | 'praise'
        | 'tip'
      >
    | Pick<
        AiChatMessageCorrection,
        | 'original_text'
        | 'corrected_sentence'
        | 'overall_score'
        | 'issues'
        | 'word_suggestions'
        | 'praise'
        | 'tip'
      >
): CorrectionAnalysis {
  return normalizeCorrectionAnalysis(
    {
      correctedSentence: correction.corrected_sentence,
      overallScore: correction.overall_score,
      issues: correction.issues,
      wordSuggestions: correction.word_suggestions,
      praise: correction.praise || '',
      tip: correction.tip || '',
    },
    correction.original_text
  )
}

export function saveFocusedCorrection(payload: FocusedCorrectionPayload) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(PLAYGROUND_CORRECTION_FOCUS_KEY, JSON.stringify(payload))
}

export function loadFocusedCorrection(): FocusedCorrectionPayload | null {
  if (typeof window === 'undefined') return null
  const raw = sessionStorage.getItem(PLAYGROUND_CORRECTION_FOCUS_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as FocusedCorrectionPayload
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.analysis || typeof parsed.originalText !== 'string') return null
    return {
      source:
        parsed.source === 'ai' || parsed.source === 'temporary' ? parsed.source : 'chat',
      originalText: parsed.originalText,
      analysis: normalizeCorrectionAnalysis(parsed.analysis, parsed.originalText),
    }
  } catch {
    return null
  }
}

export function clearFocusedCorrection() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(PLAYGROUND_CORRECTION_FOCUS_KEY)
}
