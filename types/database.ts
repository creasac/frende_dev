export type Profile = {
  id: string
  username: string
  phone_number?: string
  display_name: string
  bio?: string
  avatar_url?: string
  language_preference: string
  feedback_language: string
  auto_correction_enabled: boolean
  language_proficiency?: 'beginner' | 'intermediate' | 'advanced' | null
  tts_voice?: string | null
  tts_rate?: number | null
  created_at: string
  last_seen: string
}

export type PublicProfile = {
  id: string
  username: string
  display_name: string
  bio?: string | null
  avatar_url?: string | null
}

export type Conversation = {
  id: string
  is_group: boolean
  group_name?: string
  group_avatar_url?: string
  created_at: string
  updated_at: string
}

export type ConversationParticipant = {
  id: string
  conversation_id: string
  user_id: string
  is_admin: boolean
  joined_at: string
  hidden_at?: string
  cleared_at?: string  // Messages before this timestamp are hidden for this user
}

export type Message = {
  id: string
  conversation_id: string
  sender_id: string
  content_type: 'text'
  bypass_recipient_preferences?: boolean
  audio_path?: string | null
  processing_status?: 'processing' | 'ready' | 'failed'
  original_text?: string
  original_language?: string
  deleted_for_users: string[]
  deleted_for_everyone_by?: string
  deleted_for_everyone_at?: string
  created_at: string
}

export type MessageTranslation = {
  id: string
  message_id: string
  target_language: string
  translated_text: string
  created_at: string
}

export type MessageScaledText = {
  id: string
  message_id: string
  target_language: string
  target_proficiency: 'beginner' | 'intermediate' | 'advanced'
  scaled_text: string
  created_at: string
}

export type MessageVoiceRendering = {
  id: string
  message_id: string
  user_id: string
  source_language?: string | null
  target_language: string
  target_proficiency?: 'beginner' | 'intermediate' | 'advanced' | null
  needs_translation: boolean
  needs_scaling: boolean
  transcript_text: string
  translated_text?: string | null
  scaled_text?: string | null
  final_text: string
  final_language: string
  final_audio_path: string
  processing_status: 'processing' | 'ready' | 'failed'
  error_message?: string | null
  created_at: string
  updated_at: string
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

export type MessageStatus = {
  id: string
  message_id: string
  user_id: string
  status: 'sent' | 'delivered' | 'read'
  updated_at: string
}

export type AiChatSession = {
  id: string
  user_id: string
  name: string
  system_prompt?: string | null
  response_language?: string | null
  response_level?: 'beginner' | 'intermediate' | 'advanced' | null
  created_at: string
  updated_at: string
}

export type AiChatMessage = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

// Types for Supabase query results with joins
export type ConversationParticipantWithConversation = {
  conversation_id: string
  conversations: Conversation
}

export type OtherUserInfo = {
  username: string
  display_name: string
  avatar_url?: string | null
}

export type ConversationParticipantWithProfile = {
  conversation_id: string
  profiles: Pick<PublicProfile, 'username' | 'display_name' | 'avatar_url'>
}

export type ConversationWithOtherUser = {
  conversation_id: string
  conversations: Conversation
  otherUser?: OtherUserInfo
}

// Presence types
export type PresencePayload = {
  user_id: string
  username: string
  online_at: string
}

export type RealtimePresenceState = Record<string, PresencePayload[]>
