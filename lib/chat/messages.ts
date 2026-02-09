import { createClient } from '@/lib/supabase/client'
import { Message } from '@/types/database'
import { postJsonWithRetry } from '@/lib/ai/apiRequestQueue'

type VoiceProcessingStatus = 'processing' | 'ready' | 'failed'

type SendVoiceMessageOptions = {
  audio: Blob
  bypassRecipientPreferences?: boolean
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

// ==========================================
// Translation Retry Queue
// ==========================================

interface QueuedTranslation {
  messageId: string
  originalText: string
  sourceLanguage: string
  targetLanguage: string
  retryCount: number
  lastAttempt: number
}

// In-memory queue for failed translations
const translationQueue: Map<string, QueuedTranslation> = new Map()
const MAX_RETRIES = 4
const RETRY_DELAY_MS = 60_000
let retryIntervalId: ReturnType<typeof setInterval> | null = null

// Callbacks to notify UI when translations complete
const translationCallbacks: Map<string, (translatedText: string) => void> = new Map()

export function registerTranslationCallback(
  messageId: string,
  callback: (translatedText: string) => void
) {
  translationCallbacks.set(messageId, callback)
}

export function unregisterTranslationCallback(messageId: string) {
  translationCallbacks.delete(messageId)
}

function addToRetryQueue(item: Omit<QueuedTranslation, 'retryCount' | 'lastAttempt'>) {
  const key = `${item.messageId}:${item.targetLanguage}`
  if (!translationQueue.has(key)) {
    translationQueue.set(key, {
      ...item,
      retryCount: 1,
      lastAttempt: Date.now(),
    })
    console.log('[TranslationQueue] Added to queue:', key)
    startRetryProcessor()
  }
}

function removeFromQueue(messageId: string, targetLanguage: string) {
  const key = `${messageId}:${targetLanguage}`
  translationQueue.delete(key)
  console.log('[TranslationQueue] Removed from queue:', key)
}

async function processRetryQueue() {
  const now = Date.now()
  const itemsToRetry: QueuedTranslation[] = []

  translationQueue.forEach((item) => {
    if (now - item.lastAttempt >= RETRY_DELAY_MS) {
      itemsToRetry.push(item)
    }
  })

  for (const item of itemsToRetry) {
    if (item.retryCount >= MAX_RETRIES) {
      console.log('[TranslationQueue] Max retries reached, removing:', item.messageId)
      removeFromQueue(item.messageId, item.targetLanguage)
      translationCallbacks.delete(item.messageId)
      continue
    }

    console.log('[TranslationQueue] Retrying translation:', item.messageId, 'attempt:', item.retryCount + 1)
    
    try {
      const result = await performTranslation(
        item.messageId,
        item.originalText,
        item.sourceLanguage,
        item.targetLanguage
      )
      
      if (result) {
        removeFromQueue(item.messageId, item.targetLanguage)
        // Notify UI of successful translation
        const callback = translationCallbacks.get(item.messageId)
        if (callback) {
          callback(result.translated_text)
        }
      }
    } catch (error) {
      console.error('[TranslationQueue] Retry failed:', error)
      // Update retry count and last attempt time
      const key = `${item.messageId}:${item.targetLanguage}`
      const queueItem = translationQueue.get(key)
      if (queueItem) {
        const nextRetryCount = queueItem.retryCount + 1
        if (nextRetryCount >= MAX_RETRIES) {
          removeFromQueue(item.messageId, item.targetLanguage)
          translationCallbacks.delete(item.messageId)
        } else {
          queueItem.retryCount = nextRetryCount
          queueItem.lastAttempt = Date.now()
        }
      }
    }
  }

  // Stop processor if queue is empty
  if (translationQueue.size === 0 && retryIntervalId) {
    clearInterval(retryIntervalId)
    retryIntervalId = null
    console.log('[TranslationQueue] Queue empty, stopping processor')
  }
}

function startRetryProcessor() {
  if (!retryIntervalId) {
    console.log('[TranslationQueue] Starting retry processor')
    retryIntervalId = setInterval(processRetryQueue, RETRY_DELAY_MS)
  }
}

// Get pending translation count (for UI feedback if needed)
export function getPendingTranslationsCount(): number {
  return translationQueue.size
}

function createAudioObjectPath(
  senderId: string,
  conversationId: string,
  mimeType: string
): string {
  const safeMimeType = mimeType.toLowerCase()
  let extension = 'webm'

  if (safeMimeType.includes('mpeg') || safeMimeType.includes('mp3')) {
    extension = 'mp3'
  } else if (safeMimeType.includes('wav')) {
    extension = 'wav'
  } else if (safeMimeType.includes('ogg')) {
    extension = 'ogg'
  } else if (safeMimeType.includes('aac')) {
    extension = 'aac'
  } else if (safeMimeType.includes('mp4')) {
    extension = 'm4a'
  }

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  return `${senderId}/${conversationId}/${Date.now()}-${id}.${extension}`
}

async function updateConversationTimestamp(conversationId: string): Promise<void> {
  const supabase = createClient()
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)
}

async function setVoiceMessageStatus(messageId: string, status: VoiceProcessingStatus): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('messages')
    .update({ processing_status: status })
    .eq('id', messageId)

  if (error) {
    console.error('[messages] Failed to update voice message status:', messageId, status, error)
  }
}

async function finalizeVoiceMessageProcessing(messageId: string): Promise<void> {
  const response = await fetch('/api/voice-message/finalize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messageId }),
  })

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorData?.error || 'Failed to finalize voice message')
  }
}

// ==========================================
// Message Functions
// ==========================================

export async function sendMessage(
  conversationId: string,
  senderId: string,
  contentType: 'text',
  content: {
    text?: string
    language?: string
    bypassRecipientPreferences?: boolean
  }
) {
  const supabase = createClient()
  const wantsBypass = content.bypassRecipientPreferences === true
  const baseInsert = {
    conversation_id: conversationId,
    sender_id: senderId,
    content_type: contentType,
    original_text: content.text,
    original_language: content.language,
    processing_status: 'ready',
  }

  let { data, error } = await supabase
    .from('messages')
    .insert({
      ...baseInsert,
      bypass_recipient_preferences: wantsBypass,
    })
    .select()
    .single()

  if (error && isMissingBypassColumnError(error)) {
    if (wantsBypass) {
      throw new Error(
        'Send-as-is is unavailable because your database migration is not applied yet (messages.bypass_recipient_preferences).'
      )
    }

    const retry = await supabase
      .from('messages')
      .insert(baseInsert)
      .select()
      .single()
    data = retry.data
    error = retry.error
  }

  if (error) throw error

  // Update conversation timestamp so hidden conversations reappear on new activity.
  await updateConversationTimestamp(conversationId)

  return data
}

export async function sendVoiceMessage(
  conversationId: string,
  senderId: string,
  options: SendVoiceMessageOptions
): Promise<Message> {
  const supabase = createClient()
  const audioPath = createAudioObjectPath(senderId, conversationId, options.audio.type || 'audio/webm')
  const wantsBypass = options.bypassRecipientPreferences === true

  const { error: uploadError } = await supabase
    .storage
    .from('voice-messages')
    .upload(audioPath, options.audio, {
      contentType: options.audio.type || 'audio/webm',
      upsert: false,
    })

  if (uploadError) {
    throw uploadError
  }

  const baseInsert = {
    conversation_id: conversationId,
    sender_id: senderId,
    content_type: 'text' as const,
    audio_path: audioPath,
    processing_status: (wantsBypass ? 'ready' : 'processing') as VoiceProcessingStatus,
  }

  let { data, error } = await supabase
    .from('messages')
    .insert({
      ...baseInsert,
      bypass_recipient_preferences: wantsBypass,
    })
    .select()
    .single()

  if (error && isMissingBypassColumnError(error)) {
    if (wantsBypass) {
      throw new Error(
        'Send-as-is is unavailable because your database migration is not applied yet (messages.bypass_recipient_preferences).'
      )
    }

    const retry = await supabase
      .from('messages')
      .insert(baseInsert)
      .select()
      .single()
    data = retry.data
    error = retry.error
  }

  if (error || !data) {
    throw error || new Error('Failed to create voice message')
  }

  await updateConversationTimestamp(conversationId)

  if (!wantsBypass) {
    void finalizeVoiceMessageProcessing(data.id).catch(async (error) => {
      console.error('[messages] Voice message finalize failed:', data.id, error)
      await setVoiceMessageStatus(data.id, 'failed')
    })
  }

  return data as Message
}

export async function getConversationMessages(conversationId: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data as Message[]
}

// ==========================================
// Scaled Text Helpers (cached in DB)
// ==========================================

type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced'

async function performScaling(
  messageId: string,
  text: string,
  targetLanguage: string,
  targetProficiency: ProficiencyLevel
): Promise<{ scaled_text: string } | null> {
  const supabase = createClient()

  const apiResponse = await postJsonWithRetry<{
    wasScaled?: boolean
    scaledText?: string
  }>(
    '/api/scale',
    {
      text,
      targetLevel: targetProficiency,
      language: targetLanguage,
    },
    { source: 'performScaling', persist: true }
  )

  const scaled_text = apiResponse.scaledText || text

  const { data, error } = await supabase
    .from('message_scaled_texts')
    .insert({
      message_id: messageId,
      target_language: targetLanguage,
      target_proficiency: targetProficiency,
      scaled_text,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('message_scaled_texts')
        .select('*')
        .eq('message_id', messageId)
        .eq('target_language', targetLanguage)
        .eq('target_proficiency', targetProficiency)
        .single()
      return existing
    }
    throw error
  }

  return data
}

export async function getOrCreateScaledText(
  messageId: string,
  text: string,
  targetLanguage: string,
  targetProficiency: ProficiencyLevel
): Promise<{ scaled_text: string } | null> {
  const supabase = createClient()

  const { data: existing } = await supabase
    .from('message_scaled_texts')
    .select('*')
    .eq('message_id', messageId)
    .eq('target_language', targetLanguage)
    .eq('target_proficiency', targetProficiency)
    .single()

  if (existing) {
    console.log('[getOrCreateScaledText] Found cached scaled text:', messageId)
    return existing
  }

  try {
    const result = await performScaling(
      messageId,
      text,
      targetLanguage,
      targetProficiency
    )
    return result
  } catch (error) {
    console.error('[getOrCreateScaledText] Scaling failed:', error)
    return null
  }
}

// Internal function to perform the actual translation API call and store result
async function performTranslation(
  messageId: string,
  originalText: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<{ translated_text: string } | null> {
  const supabase = createClient()

  // Call translation API
  console.log('[performTranslation] Calling translate API:', {
    messageId,
    source_lang: sourceLanguage,
    target_lang: targetLanguage,
  })

  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: originalText,
      source_lang: sourceLanguage,
      target_lang: targetLanguage,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Translation failed' }))
    const message =
      (errorData as { error?: string; message?: string }).error ||
      (errorData as { error?: string; message?: string }).message ||
      'Translation failed'
    throw new Error(message)
  }

  const apiResponse = await response.json().catch(() => null) as { translated_text?: string } | null
  const translated_text = apiResponse?.translated_text

  if (!translated_text) {
    throw new Error('Translation API did not return translated_text')
  }

  // Store translation in database
  const { data, error } = await supabase
    .from('message_translations')
    .insert({
      message_id: messageId,
      target_language: targetLanguage,
      translated_text,
    })
    .select()
    .single()

  if (error) {
    // If insert failed due to duplicate, try to fetch existing
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('message_translations')
        .select('*')
        .eq('message_id', messageId)
        .eq('target_language', targetLanguage)
        .single()
      return existing
    }
    throw error
  }

  console.log('[performTranslation] Translation stored successfully:', messageId)
  return data
}

// Main function to get or create translation with retry queue support
export async function getOrCreateTranslation(
  messageId: string,
  originalText: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<{ translated_text: string } | null> {
  const supabase = createClient()

  // Check if translation exists in database
  const { data: existing } = await supabase
    .from('message_translations')
    .select('*')
    .eq('message_id', messageId)
    .eq('target_language', targetLanguage)
    .single()

  if (existing) {
    console.log('[getOrCreateTranslation] Found cached translation:', messageId)
    return existing
  }

  // Try to translate
  try {
    const result = await performTranslation(
      messageId,
      originalText,
      sourceLanguage,
      targetLanguage
    )
    return result
  } catch (error) {
    console.error('[getOrCreateTranslation] Translation failed, adding to retry queue:', error)
    
    // Add to retry queue for later
    addToRetryQueue({
      messageId,
      originalText,
      sourceLanguage,
      targetLanguage,
    })
    
    // Return null to indicate translation is pending
    return null
  }
}
