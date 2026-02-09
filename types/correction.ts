export type CorrectionIssueType =
  | 'grammar'
  | 'spelling'
  | 'word_choice'
  | 'punctuation'
  | 'style'

export type CorrectionIssue = {
  type: CorrectionIssueType
  original: string
  correction: string
  explanation: string
  position: string
}

export type CorrectionWordSuggestion = {
  original: string
  alternatives: string[]
  reason: string
}

export type CorrectionAnalysis = {
  correctedSentence: string
  overallScore: number
  issues: CorrectionIssue[]
  wordSuggestions: CorrectionWordSuggestion[]
  praise: string
  tip: string
}

export type MessageCorrection = {
  id: string
  message_id: string
  user_id: string
  feedback_language: string
  original_text: string
  corrected_sentence: string
  overall_score: number
  issues: unknown
  word_suggestions: unknown
  praise?: string | null
  tip?: string | null
  has_issues: boolean
  created_at: string
  updated_at: string
}

export type AiChatMessageCorrection = {
  id: string
  ai_message_id: string
  user_id: string
  feedback_language: string
  original_text: string
  corrected_sentence: string
  overall_score: number
  issues: unknown
  word_suggestions: unknown
  praise?: string | null
  tip?: string | null
  has_issues: boolean
  created_at: string
  updated_at: string
}

export type FocusedCorrectionPayload = {
  source: 'chat' | 'ai' | 'temporary'
  originalText: string
  analysis: CorrectionAnalysis
}
