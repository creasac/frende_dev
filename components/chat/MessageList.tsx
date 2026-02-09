'use client'

import { useEffect, useState, useRef, useMemo, useCallback, useLayoutEffect, type MouseEvent } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Message, MessageVoiceRendering } from '@/types/database'
import { type MessageCorrection } from '@/types/correction'
import { getOrCreateTranslation, getOrCreateScaledText, registerTranslationCallback, unregisterTranslationCallback } from '@/lib/chat/messages'
import { getMessageCache, setMessageCache } from '@/lib/chat/messageCache'
import { unhideConversationForUser, getClearedAtForUser } from '@/lib/chat/conversations'
import VoiceMessagePlayer from '@/components/chat/VoiceMessagePlayer'
import useEdgeTtsPlayer from '@/hooks/useEdgeTtsPlayer'
import CorrectionSummary from '@/components/correction/CorrectionSummary'
import CorrectionDetailsModal from '@/components/correction/CorrectionDetailsModal'
import {
  analysisFromStoredCorrection,
  fetchMessageCorrections,
  upsertMessageCorrection,
} from '@/lib/corrections/client'

interface SenderProfile {
  id: string
  display_name: string
  username: string
  avatar_url?: string | null
}

type FeatureKey = 'translate' | 'alternatives' | 'correction' | 'scale'
type MessageViewOverride = 'unscaled' | 'original'

const PLAYGROUND_STORAGE_KEY = 'playgroundDraftText'
const MESSAGE_PAGE_LIMIT = 15

type VoiceRendering = Pick<
  MessageVoiceRendering,
  | 'message_id'
  | 'source_language'
  | 'target_language'
  | 'target_proficiency'
  | 'needs_translation'
  | 'needs_scaling'
  | 'transcript_text'
  | 'translated_text'
  | 'scaled_text'
  | 'final_text'
  | 'final_language'
  | 'final_audio_path'
  | 'processing_status'
  | 'error_message'
>

const CONTEXT_MENU_ACTIONS: { key: FeatureKey; label: string }[] = [
  { key: 'translate', label: 'Translate' },
  { key: 'alternatives', label: 'Alternatives' },
  { key: 'correction', label: 'Correction' },
  { key: 'scale', label: 'Scale' },
]

// Helper function to format message timestamp
function formatMessageTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  // Format time without seconds
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // Determine date label - Today or date format like "3 Jan"
  let dateLabel: string
  if (messageDate.getTime() === today.getTime()) {
    dateLabel = 'Today'
  } else {
    dateLabel = date.toLocaleDateString([], { day: 'numeric', month: 'short' })
  }

  return `${timeStr}, ${dateLabel}`
}

function isBypassMessage(message: Message): boolean {
  return message.bypass_recipient_preferences === true
}

function getErrorSummary(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown; details?: unknown; hint?: unknown }
    if (typeof candidate.message === 'string' && candidate.message.trim().length > 0) {
      return candidate.message
    }
    if (typeof candidate.details === 'string' && candidate.details.trim().length > 0) {
      return candidate.details
    }
    if (typeof candidate.hint === 'string' && candidate.hint.trim().length > 0) {
      return candidate.hint
    }
  }
  return 'Unknown error'
}

export default function MessageList({
  conversationId,
  userId,
  userLanguage,
  feedbackLanguage = 'en',
  autoCorrectionEnabled = true,
  userProficiency = null,
  speechVoice = null,
  speechRate = 0,
  isGroup = false,
  onHasMessagesChange,
}: {
  conversationId: string
  userId: string
  userLanguage: string
  feedbackLanguage?: string
  autoCorrectionEnabled?: boolean
  userProficiency?: 'beginner' | 'intermediate' | 'advanced' | null
  speechVoice?: string | null
  speechRate?: number | null
  isGroup?: boolean
  onHasMessagesChange?: (hasMessages: boolean) => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [scaledTexts, setScaledTexts] = useState<Record<string, string>>({})
  const [messageCorrections, setMessageCorrections] = useState<Record<string, MessageCorrection>>({})
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const [voiceRenderings, setVoiceRenderings] = useState<Record<string, VoiceRendering>>({})
  const [voiceRenderingAudioUrls, setVoiceRenderingAudioUrls] = useState<Record<string, string>>({})
  const [messageViewOverrides, setMessageViewOverrides] = useState<
    Record<string, Record<string, MessageViewOverride>>
  >({})
  const [loading, setLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [oldestMessageAt, setOldestMessageAt] = useState<string | null>(null)
  // Track which messages have been processed to avoid duplicate API calls
  const processedTranslations = useRef<Set<string>>(new Set())
  const processedScaling = useRef<Set<string>>(new Set())
  const processedCorrections = useRef<Set<string>>(new Set())
  // Only attempt chat auto-correction for messages observed as new in this live session.
  const correctionEligibleLiveMessageIdsRef = useRef<Set<string>>(new Set())
  const [clearedAt, setClearedAt] = useState<string | null>(null)
  const [senderProfiles, setSenderProfiles] = useState<Record<string, SenderProfile>>({})
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    displayText: string
    needsTranslation: boolean
    message: Message
  } | null>(null)
  const [openCorrectionDetail, setOpenCorrectionDetail] = useState<{
    originalText: string
    analysis: ReturnType<typeof analysisFromStoredCorrection>
  } | null>(null)
  const [visibleVoiceTranscripts, setVisibleVoiceTranscripts] = useState<Record<string, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const skipAutoScrollRef = useRef(false)
  const skipGroupBottomAlignRef = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const {
    loadingMessageId: loadingSpeechMessageId,
    playingMessageId: playingSpeechMessageId,
    toggleSpeech,
  } = useEdgeTtsPlayer()

  // Use refs to avoid stale closures in subscription callbacks
  const userLanguageRef = useRef(userLanguage)
  const feedbackLanguageRef = useRef(feedbackLanguage)
  const autoCorrectionEnabledRef = useRef(autoCorrectionEnabled)
  const userProficiencyRef = useRef(userProficiency)
  const clearedAtRef = useRef<string | null>(null)
  const messageIdSetRef = useRef<Set<string>>(new Set())
  const messageCorrectionsRef = useRef<Record<string, MessageCorrection>>({})
  const requestedAudioSignatureKeysRef = useRef<Set<string>>(new Set())
  const requestedVoiceRenderingAudioSignatureKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    userLanguageRef.current = userLanguage
  }, [userLanguage])

  useEffect(() => {
    feedbackLanguageRef.current = feedbackLanguage || 'en'
  }, [feedbackLanguage])

  useEffect(() => {
    autoCorrectionEnabledRef.current = autoCorrectionEnabled
  }, [autoCorrectionEnabled])

  useEffect(() => {
    userProficiencyRef.current = userProficiency
  }, [userProficiency])

  useEffect(() => {
    clearedAtRef.current = clearedAt
  }, [clearedAt])

  useEffect(() => {
    messageIdSetRef.current = new Set(messages.map((message) => message.id))
  }, [messages])

  useEffect(() => {
    messageCorrectionsRef.current = messageCorrections
  }, [messageCorrections])

  useEffect(() => {
    if (!contextMenu) return

    function handleDocumentClick(event: globalThis.MouseEvent) {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) {
        return
      }
      setContextMenu(null)
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }

    window.addEventListener('mousedown', handleDocumentClick)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('mousedown', handleDocumentClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu])

  // Scale message to user's proficiency level
  const scaleMessage = useCallback(async (messageId: string, text: string, targetLanguage: string) => {
    const proficiency = userProficiencyRef.current
    if (!proficiency) return

    // Prevent duplicate scaling calls
    const scalingKey = `${messageId}:${targetLanguage}:${proficiency}`
    if (processedScaling.current.has(scalingKey)) {
      console.log('[MessageList] Scaling already in progress or done, skipping:', messageId)
      return
    }
    processedScaling.current.add(scalingKey)

    try {
      const data = await getOrCreateScaledText(
        messageId,
        text,
        targetLanguage,
        proficiency
      )
      if (data?.scaled_text) {
        setScaledTexts(prev => ({
          ...prev,
          [messageId]: data.scaled_text,
        }))
      }
    } catch (error) {
      console.error('[MessageList] Scaling failed:', error)
    }
  }, [])

  // Memoize translateMessage to use in subscription
  const translateMessage = useMemo(() => {
    return async (message: Message, options?: { shouldScale?: boolean }) => {
      const shouldScale = options?.shouldScale === true
      if (!message.original_text || !message.original_language) {
        console.log('[MessageList] Skipping translation - missing text or language:', {
          hasText: !!message.original_text,
          hasLanguage: !!message.original_language,
        })
        return
      }

      if (isBypassMessage(message)) {
        return
      }

      if (message.sender_id === userId) {
        return
      }

      // Prevent duplicate translation calls
      const translationKey = `${message.id}:${userLanguageRef.current}`
      if (processedTranslations.current.has(translationKey)) {
        console.log('[MessageList] Translation already in progress or done, skipping:', message.id)
        return
      }
      processedTranslations.current.add(translationKey)

      const targetLang = userLanguageRef.current
      console.log('[MessageList] Translating message:', {
        messageId: message.id,
        originalLanguage: message.original_language,
        targetLanguage: targetLang,
        text: message.original_text.substring(0, 50),
      })

      // Register callback for retry queue updates
      registerTranslationCallback(message.id, async (translatedText: string) => {
        console.log('[MessageList] Translation callback received:', message.id)
        setTranslations((prev) => ({
          ...prev,
          [message.id]: translatedText,
        }))

        // Scale the translated text if proficiency is set
        if (shouldScale && userProficiencyRef.current) {
          await scaleMessage(message.id, translatedText, userLanguageRef.current)
        }
      })

      try {
        const result = await getOrCreateTranslation(
          message.id,
          message.original_text,
          message.original_language,
          targetLang
        )

        if (result && result.translated_text) {
          console.log('[MessageList] Translation received:', result.translated_text.substring(0, 50))
          setTranslations((prev) => ({
            ...prev,
            [message.id]: result.translated_text,
          }))
          unregisterTranslationCallback(message.id)

          if (shouldScale && userProficiencyRef.current) {
            await scaleMessage(message.id, result.translated_text, userLanguageRef.current)
          }
        } else {
          console.log('[MessageList] Translation queued for retry:', message.id)
        }
      } catch (error) {
        console.error('[MessageList] Translation failed:', error)
      }
    }
  }, [scaleMessage, userId])

  const fetchMessagesPage = useCallback(
    async ({
      before,
      clearedAt,
      limit = MESSAGE_PAGE_LIMIT,
    }: {
      before?: string
      clearedAt: string | null
      limit?: number
    }) => {
      const supabase = createClient()
      let query = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit + 1)

      if (clearedAt) {
        query = query.gt('created_at', clearedAt)
      }

      if (before) {
        query = query.lt('created_at', before)
      }

      const { data, error } = await query
      if (error || !data) {
        return { messages: [], hasMore: false }
      }

      const hasMore = data.length > limit
      const page = hasMore ? data.slice(0, limit) : data
      return { messages: [...page].reverse(), hasMore }
    },
    [conversationId]
  )

  const fetchMessageEnhancements = useCallback(
    async (messagesToEnhance: Message[]) => {
      const supabase = createClient()
      const messageIds = messagesToEnhance.map((message) => message.id)
      let translations: Record<string, string> = {}
      let scaled: Record<string, string> = {}
      let corrections: Record<string, MessageCorrection> = {}

      if (messageIds.length === 0) {
        return { translations, scaled, corrections }
      }

      const { data: translationRows, error: translationError } = await supabase
        .from('message_translations')
        .select('message_id, translated_text')
        .eq('target_language', userLanguage)
        .in('message_id', messageIds)

      if (!translationError && translationRows) {
        translations = translationRows.reduce<Record<string, string>>((acc, row) => {
          acc[row.message_id] = row.translated_text
          return acc
        }, {})
      }

      if (userProficiency) {
        const { data: scaledRows, error: scaledError } = await supabase
          .from('message_scaled_texts')
          .select('message_id, scaled_text')
          .eq('target_language', userLanguage)
          .eq('target_proficiency', userProficiency)
          .in('message_id', messageIds)

        if (!scaledError && scaledRows) {
          scaled = scaledRows.reduce<Record<string, string>>((acc, row) => {
            acc[row.message_id] = row.scaled_text
            return acc
          }, {})
        }
      }

      const ownMessageIds =
        autoCorrectionEnabled
          ? messagesToEnhance
              .filter((message) => message.sender_id === userId && !isBypassMessage(message))
              .map((message) => message.id)
          : []

      if (autoCorrectionEnabled && ownMessageIds.length > 0) {
        try {
          corrections = await fetchMessageCorrections({ messageIds: ownMessageIds, userId })
        } catch (error) {
          console.error('[MessageList] Failed to fetch message corrections:', getErrorSummary(error), error)
        }
      }

      return { translations, scaled, corrections }
    },
    [autoCorrectionEnabled, userLanguage, userProficiency, userId]
  )

  function mergeMessages(existing: Message[], incoming: Message[]) {
    const map = new Map(existing.map((msg) => [msg.id, msg]))
    incoming.forEach((msg) => map.set(msg.id, msg))
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  }

  const queueMissingTranslations = useCallback((
    messagesToCheck: Message[],
    existingTranslations: Record<string, string>
  ) => {
    messagesToCheck.forEach((msg) => {
      if (
        msg.audio_path ||
        isBypassMessage(msg) ||
        msg.processing_status === 'processing' ||
        msg.processing_status === 'failed' ||
        !msg.original_text ||
        !msg.original_language
      ) {
        return
      }

      const needsTranslation =
        msg.original_language !== userLanguage &&
        msg.original_text

      if (needsTranslation && msg.sender_id !== userId && !existingTranslations[msg.id]) {
        void translateMessage(msg, { shouldScale: false })
      }
    })
  }, [translateMessage, userId, userLanguage])

  const queueMissingCorrections = useCallback((
    messagesToCheck: Message[],
    existingCorrections: Record<string, MessageCorrection>
  ) => {
    if (!autoCorrectionEnabledRef.current) {
      return
    }

    messagesToCheck.forEach((msg) => {
      if (
        msg.sender_id !== userId ||
        isBypassMessage(msg) ||
        msg.processing_status === 'processing' ||
        msg.processing_status === 'failed' ||
        !msg.original_text
      ) {
        return
      }

      if (existingCorrections[msg.id] || processedCorrections.current.has(msg.id)) {
        return
      }

      processedCorrections.current.add(msg.id)

      void upsertMessageCorrection({
        messageId: msg.id,
        userId,
        text: msg.original_text,
        feedbackLanguage: feedbackLanguageRef.current || 'en',
        source: 'MessageList.queueMissingCorrections',
      })
        .then((correction) => {
          if (!correction) return
          setMessageCorrections((prev) => ({
            ...prev,
            [msg.id]: correction,
          }))
        })
        .catch((error) => {
          processedCorrections.current.delete(msg.id)
          console.error('[MessageList] Failed to create message correction:', error)
        })
    })
  }, [userId])

  const resolveAudioUrls = useCallback(async (messagesToResolve: Message[]) => {
    if (messagesToResolve.length === 0) {
      return
    }

    const supabase = createClient()

    for (const message of messagesToResolve) {
      if (!message.audio_path) {
        continue
      }

      const signatureKey = `${message.id}:${message.audio_path}`
      if (requestedAudioSignatureKeysRef.current.has(signatureKey)) {
        continue
      }

      requestedAudioSignatureKeysRef.current.add(signatureKey)

      const { data, error } = await supabase
        .storage
        .from('voice-messages')
        .createSignedUrl(message.audio_path, 60 * 60)

      if (error || !data?.signedUrl) {
        console.error('[MessageList] Failed to create signed audio URL:', message.id, error)
        requestedAudioSignatureKeysRef.current.delete(signatureKey)
        continue
      }

      setAudioUrls((prev) => ({
        ...prev,
        [message.id]: data.signedUrl,
      }))
    }
  }, [])

  const resolveVoiceRenderingAudioUrls = useCallback(async (renderings: VoiceRendering[]) => {
    if (renderings.length === 0) {
      return
    }

    const supabase = createClient()

    for (const rendering of renderings) {
      if (!rendering.final_audio_path) {
        continue
      }

      const signatureKey = `${rendering.message_id}:${rendering.final_audio_path}`
      if (requestedVoiceRenderingAudioSignatureKeysRef.current.has(signatureKey)) {
        continue
      }

      requestedVoiceRenderingAudioSignatureKeysRef.current.add(signatureKey)

      const { data, error } = await supabase
        .storage
        .from('voice-messages')
        .createSignedUrl(rendering.final_audio_path, 60 * 60)

      if (error || !data?.signedUrl) {
        console.error(
          '[MessageList] Failed to create signed final voice URL:',
          rendering.message_id,
          error
        )
        requestedVoiceRenderingAudioSignatureKeysRef.current.delete(signatureKey)
        continue
      }

      setVoiceRenderingAudioUrls((prev) => ({
        ...prev,
        [rendering.message_id]: data.signedUrl,
      }))
    }
  }, [])

  const fetchVoiceRenderings = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      return
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('message_voice_renderings')
      .select(`
        message_id,
        source_language,
        target_language,
        target_proficiency,
        needs_translation,
        needs_scaling,
        transcript_text,
        translated_text,
        scaled_text,
        final_text,
        final_language,
        final_audio_path,
        processing_status,
        error_message
      `)
      .eq('user_id', userId)
      .in('message_id', messageIds)

    if (error || !data) {
      console.error('[MessageList] Failed to fetch voice renderings:', error)
      return
    }

    const rows = data as VoiceRendering[]
    if (rows.length === 0) {
      return
    }

    setVoiceRenderings((prev) => {
      const next = { ...prev }
      for (const row of rows) {
        next[row.message_id] = row
      }
      return next
    })

    void resolveVoiceRenderingAudioUrls(rows)
  }, [resolveVoiceRenderingAudioUrls, userId])

  const currentMessageViewOverrides = useMemo(
    () => messageViewOverrides[conversationId] || {},
    [messageViewOverrides, conversationId]
  )

  const resolveMessageDisplay = useCallback((message: Message) => {
    const isOwn = message.sender_id === userId
    const isFailed = message.processing_status === 'failed'
    const isVoiceMessage = !!message.audio_path
    const isBypass = isBypassMessage(message)
    const needsTranslation =
      !isBypass &&
      !isFailed &&
      !isOwn &&
      message.original_language !== userLanguage &&
      !!message.original_text

    const viewOverride = currentMessageViewOverrides[message.id]
    let displayText = message.original_text || ''

    if (isVoiceMessage) {
      if (isBypass) {
        return { displayText: '', needsTranslation: false }
      }

      if (isOwn) {
        if (message.processing_status !== 'ready') {
          return { displayText: '', needsTranslation: false }
        }
        return { displayText: message.original_text || '', needsTranslation: false }
      }

      const rendering = voiceRenderings[message.id]
      if (message.processing_status === 'failed') {
        return { displayText: 'Voice message processing failed.', needsTranslation: false }
      }

      if (message.processing_status === 'processing' || !rendering) {
        return { displayText: 'Voice message is processing...', needsTranslation: false }
      }

      if (rendering.processing_status === 'failed') {
        displayText =
          rendering.final_text ||
          rendering.scaled_text ||
          rendering.translated_text ||
          rendering.transcript_text ||
          'Voice message unavailable.'
        return { displayText, needsTranslation: rendering.needs_translation }
      }

      if (rendering.processing_status !== 'ready') {
        return { displayText: 'Voice message is processing...', needsTranslation: false }
      }

      if (viewOverride === 'original') {
        displayText = message.original_text || rendering.transcript_text || ''
      } else if (viewOverride === 'unscaled') {
        displayText = rendering.translated_text || rendering.transcript_text || ''
      } else {
        displayText = rendering.final_text || rendering.transcript_text || ''
      }

      return { displayText, needsTranslation: rendering.needs_translation }
    }

    if (isFailed) {
      displayText = isOwn ? 'Voice message processing failed.' : 'Voice message unavailable.'
    } else if (viewOverride === 'original') {
      displayText = message.original_text || ''
    } else if (viewOverride === 'unscaled') {
      if (needsTranslation) {
        displayText = translations[message.id] || message.original_text || ''
      } else {
        displayText = message.original_text || ''
      }
    } else if (needsTranslation && translations[message.id]) {
      displayText = scaledTexts[message.id] || translations[message.id]
    } else if (!isBypass && !needsTranslation && !isOwn && userProficiency && scaledTexts[message.id]) {
      displayText = scaledTexts[message.id]
    }

    return { displayText, needsTranslation }
  }, [
    currentMessageViewOverrides,
    scaledTexts,
    translations,
    userId,
    userLanguage,
    userProficiency,
    voiceRenderings,
  ])

  const resolveSpeechLanguage = useCallback((message: Message, needsTranslation: boolean) => {
    const viewOverride = currentMessageViewOverrides[message.id]
    const rendering = voiceRenderings[message.id]

    if (message.audio_path && message.sender_id !== userId && rendering) {
      if (viewOverride === 'original') {
        return rendering.source_language || message.original_language || userLanguage
      }
      if (viewOverride === 'unscaled') {
        return rendering.needs_translation
          ? rendering.target_language || userLanguage
          : rendering.source_language || userLanguage
      }
      return rendering.final_language || userLanguage
    }

    if (viewOverride === 'original') {
      return message.original_language || userLanguage
    }
    return needsTranslation ? userLanguage : message.original_language || userLanguage
  }, [currentMessageViewOverrides, userId, userLanguage, voiceRenderings])

  const visibleMessages = useMemo(() => {
    return messages.filter((message) => {
      if (message.processing_status === 'processing') {
        return true
      }

      if (message.processing_status === 'failed') {
        return true
      }

      if (message.audio_path && message.sender_id !== userId) {
        if (isBypassMessage(message)) {
          return true
        }
        const rendering = voiceRenderings[message.id]
        return rendering?.processing_status === 'ready' || rendering?.processing_status === 'failed'
      }

      if (!message.original_text) {
        return !!message.audio_path
      }

      const isOwn = message.sender_id === userId
      const isBypass = isBypassMessage(message)
      const needsTranslation =
        !isBypass && !isOwn && message.original_language !== userLanguage && message.original_text
      const viewOverride = currentMessageViewOverrides[message.id]

      if (
        needsTranslation &&
        !translations[message.id] &&
        viewOverride !== 'original' &&
        !message.audio_path
      ) {
        return false
      }

      return true
    })
  }, [messages, currentMessageViewOverrides, translations, userId, userLanguage, voiceRenderings])

  useEffect(() => {
    const supabase = createClient()

    // Clear processed tracking when conversation changes
    processedTranslations.current.clear()
    processedScaling.current.clear()
    processedCorrections.current.clear()
    correctionEligibleLiveMessageIdsRef.current.clear()

    // Unhide the conversation when user opens it (in case it was hidden)
    unhideConversationForUser(conversationId, userId)

    async function loadMessages() {
      setLoading(true)
      setMessages([])
      setTranslations({})
      setScaledTexts({})
      setMessageCorrections({})
      setAudioUrls({})
      setVoiceRenderings({})
      setVoiceRenderingAudioUrls({})
      setVisibleVoiceTranscripts({})
      setHasMore(false)
      setOldestMessageAt(null)
      requestedAudioSignatureKeysRef.current.clear()
      requestedVoiceRenderingAudioSignatureKeysRef.current.clear()

      // First, get the cleared_at timestamp for this user
      const userClearedAt = await getClearedAtForUser(conversationId, userId)
      setClearedAt(userClearedAt)

      const cached = getMessageCache(conversationId, userClearedAt)
      if (cached) {
        setMessages(cached.messages)
        setTranslations(cached.translations)
        setScaledTexts(cached.scaledTexts)
        setHasMore(cached.hasMore)
        setOldestMessageAt(cached.oldestCreatedAt)
        setLoading(false)
        queueMissingTranslations(cached.messages, cached.translations)
        void resolveAudioUrls(cached.messages)
        void fetchVoiceRenderings(cached.messages.map((msg) => msg.id))
      }

      const { messages: pageMessages, hasMore: pageHasMore } = await fetchMessagesPage({
        clearedAt: userClearedAt,
      })

      const mergedMessages = cached ? mergeMessages(cached.messages, pageMessages) : pageMessages
      const {
        translations: mergedPageTranslations,
        scaled: mergedPageScaled,
        corrections: mergedPageCorrections,
      } = await fetchMessageEnhancements(mergedMessages)
      const mergedTranslations = cached
        ? { ...cached.translations, ...mergedPageTranslations }
        : mergedPageTranslations
      const mergedCorrections = mergedPageCorrections

      setMessages(mergedMessages)
      setTranslations((prev) => ({ ...prev, ...mergedPageTranslations }))
      setScaledTexts((prev) => ({ ...prev, ...mergedPageScaled }))
      setMessageCorrections(mergedCorrections)
      setHasMore(pageHasMore)
      setOldestMessageAt(mergedMessages[0]?.created_at ?? null)
      setLoading(false)

      queueMissingTranslations(mergedMessages, mergedTranslations)
      void resolveAudioUrls(mergedMessages)
      void fetchVoiceRenderings(mergedMessages.map((msg) => msg.id))

      // For group chats, fetch sender profiles
      if (isGroup && mergedMessages.length > 0) {
        const senderIds = [...new Set(mergedMessages.map(msg => msg.sender_id).filter(Boolean))]
        if (senderIds.length > 0) {
          const { data: profiles } = await supabase
            .from('public_profiles')
            .select('id, display_name, username, avatar_url')
            .in('id', senderIds)

          if (profiles) {
            const profileMap: Record<string, SenderProfile> = {}
            profiles.forEach(p => {
              profileMap[p.id] = p
            })
            setSenderProfiles(profileMap)
          }
        }
      }
    }

    loadMessages()

    function handleIncomingMessage(incomingMessage: Message, eventType: 'INSERT' | 'UPDATE') {
      const currentClearedAt = clearedAtRef.current
      if (currentClearedAt && new Date(incomingMessage.created_at) <= new Date(currentClearedAt)) {
        return
      }

      if (
        (eventType === 'INSERT' || !messageIdSetRef.current.has(incomingMessage.id)) &&
        incomingMessage.sender_id === userId &&
        !isBypassMessage(incomingMessage)
      ) {
        correctionEligibleLiveMessageIdsRef.current.add(incomingMessage.id)
      }

      setMessages((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === incomingMessage.id)
        if (existingIndex === -1) {
          return [...prev, incomingMessage].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
        }

        const next = [...prev]
        next[existingIndex] = { ...next[existingIndex], ...incomingMessage }
        return next
      })
      void resolveAudioUrls([incomingMessage])
      void fetchVoiceRenderings([incomingMessage.id])

      if (
        incomingMessage.processing_status !== 'processing' &&
        incomingMessage.processing_status !== 'failed' &&
        !incomingMessage.audio_path &&
        !isBypassMessage(incomingMessage) &&
        incomingMessage.original_text &&
        incomingMessage.original_language
      ) {
        if (
          incomingMessage.original_language !== userLanguageRef.current &&
          incomingMessage.sender_id !== userId
        ) {
          void translateMessage(incomingMessage, { shouldScale: true })
        } else if (
          incomingMessage.original_language === userLanguageRef.current &&
          userProficiencyRef.current &&
          incomingMessage.sender_id !== userId
        ) {
          void scaleMessage(
            incomingMessage.id,
            incomingMessage.original_text,
            incomingMessage.original_language
          )
        }
      }

      if (correctionEligibleLiveMessageIdsRef.current.has(incomingMessage.id)) {
        queueMissingCorrections([incomingMessage], messageCorrectionsRef.current)
      }

      if (isGroup && incomingMessage.sender_id) {
        setSenderProfiles((prev) => {
          if (prev[incomingMessage.sender_id]) return prev
          supabase
            .from('public_profiles')
            .select('id, display_name, username, avatar_url')
            .eq('id', incomingMessage.sender_id)
            .single()
            .then(({ data }) => {
              if (data) {
                setSenderProfiles((current) => ({ ...current, [data.id]: data }))
              }
            })
          return prev
        })
      }

    }

    // Subscribe to messages + enhancement updates
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          handleIncomingMessage(payload.new as Message, 'INSERT')
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          handleIncomingMessage(payload.new as Message, 'UPDATE')
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_translations',
          filter: `target_language=eq.${userLanguage}`,
        },
        (payload) => {
          const row = payload.new as {
            message_id: string
            translated_text: string
          }

          if (!messageIdSetRef.current.has(row.message_id)) {
            return
          }

          setTranslations((prev) => ({
            ...prev,
            [row.message_id]: row.translated_text,
          }))

          if (userProficiencyRef.current) {
            void scaleMessage(row.message_id, row.translated_text, userLanguageRef.current)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_scaled_texts',
          filter: `target_language=eq.${userLanguage}`,
        },
        (payload) => {
          const row = payload.new as {
            message_id: string
            scaled_text: string
            target_proficiency: 'beginner' | 'intermediate' | 'advanced'
          }

          if (!messageIdSetRef.current.has(row.message_id)) {
            return
          }

          if (!userProficiencyRef.current || row.target_proficiency !== userProficiencyRef.current) {
            return
          }

          setScaledTexts((prev) => ({
            ...prev,
            [row.message_id]: row.scaled_text,
          }))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_corrections',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!autoCorrectionEnabledRef.current) {
            return
          }
          const row = payload.new as MessageCorrection
          if (!messageIdSetRef.current.has(row.message_id)) {
            return
          }
          processedCorrections.current.add(row.message_id)
          setMessageCorrections((prev) => ({
            ...prev,
            [row.message_id]: row,
          }))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'message_corrections',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!autoCorrectionEnabledRef.current) {
            return
          }
          const row = payload.new as MessageCorrection
          if (!messageIdSetRef.current.has(row.message_id)) {
            return
          }
          processedCorrections.current.add(row.message_id)
          setMessageCorrections((prev) => ({
            ...prev,
            [row.message_id]: row,
          }))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_voice_renderings',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as VoiceRendering
          if (!messageIdSetRef.current.has(row.message_id)) {
            return
          }
          setVoiceRenderings((prev) => ({
            ...prev,
            [row.message_id]: row,
          }))
          void resolveVoiceRenderingAudioUrls([row])
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'message_voice_renderings',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as VoiceRendering
          if (!messageIdSetRef.current.has(row.message_id)) {
            return
          }
          setVoiceRenderings((prev) => ({
            ...prev,
            [row.message_id]: row,
          }))
          void resolveVoiceRenderingAudioUrls([row])
        }
      )
      .subscribe((status) => {
        console.log('Subscription status:', status)
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to messages for conversation:', conversationId)
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Channel subscription error')
        }
      })

    return () => {
      console.log('Cleaning up subscription')
      supabase.removeChannel(channel)
    }
  }, [
    conversationId,
    userLanguage,
    userProficiency,
    translateMessage,
    scaleMessage,
    queueMissingTranslations,
    queueMissingCorrections,
    resolveAudioUrls,
    fetchVoiceRenderings,
    resolveVoiceRenderingAudioUrls,
    fetchMessagesPage,
    fetchMessageEnhancements,
    isGroup,
    userId,
  ])

  useLayoutEffect(() => {
    if (isLoadingMore) return
    if (loading) return
    if (visibleMessages.length === 0) return
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false
      return
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [visibleMessages.length, isLoadingMore, loading])

  useLayoutEffect(() => {
    if (isLoadingMore) return
    if (!isGroup || messages.length === 0) return
    if (Object.keys(senderProfiles).length === 0) return
    if (skipGroupBottomAlignRef.current) {
      skipGroupBottomAlignRef.current = false
      return
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [senderProfiles, isGroup, messages.length, isLoadingMore])

  useEffect(() => {
    onHasMessagesChange?.(visibleMessages.length > 0)
  }, [visibleMessages.length, onHasMessagesChange])

  // Cleanup callbacks when component unmounts
  useEffect(() => {
    return () => {
      messages.forEach(msg => {
        unregisterTranslationCallback(msg.id)
      })
    }
  }, [messages])

  useEffect(() => {
    if (loading) return
    setMessageCache(conversationId, {
      messages,
      translations,
      scaledTexts,
      oldestCreatedAt: oldestMessageAt,
      hasMore,
      clearedAt,
      cachedAt: Date.now(),
    })
  }, [conversationId, messages, translations, scaledTexts, oldestMessageAt, hasMore, clearedAt, loading])

  function openContextMenu(
    event: MouseEvent<HTMLDivElement>,
    message: Message,
    displayText: string,
    needsTranslation: boolean
  ) {
    event.preventDefault()
    const menuWidth = 220
    const menuHeight = 320
    const padding = 12
    const maxX = window.innerWidth - menuWidth - padding
    const maxY = window.innerHeight - menuHeight - padding
    const x = Math.min(event.clientX, maxX)
    const y = Math.min(event.clientY, maxY)
    setContextMenu({
      x: Math.max(padding, x),
      y: Math.max(padding, y),
      displayText,
      needsTranslation,
      message,
    })
  }

  function handleContextAction(feature: FeatureKey) {
    if (!contextMenu) return
    try {
      sessionStorage.setItem(PLAYGROUND_STORAGE_KEY, contextMenu.displayText)
    } catch (error) {
      console.error('Failed to store playground draft text:', error)
    }
    setContextMenu(null)
    router.push(`/play/${feature}`)
  }

  function handleShowUnscaled() {
    if (!contextMenu) return
    const { message, needsTranslation } = contextMenu
    if (!message.audio_path && needsTranslation && message.original_text && message.original_language) {
      if (!translations[message.id]) {
        translateMessage(message, { shouldScale: false })
      }
    }
    setMessageViewOverrides(prev => ({
      ...prev,
      [conversationId]: {
        ...(prev[conversationId] || {}),
        [message.id]: 'unscaled',
      },
    }))
    setContextMenu(null)
  }

  function handleShowOriginal() {
    if (!contextMenu) return
    const { message } = contextMenu
    if (!message.original_text) return
    setMessageViewOverrides(prev => ({
      ...prev,
      [conversationId]: {
        ...(prev[conversationId] || {}),
        [message.id]: 'original',
      },
    }))
    setContextMenu(null)
  }

  async function loadOlderMessages() {
    if (!oldestMessageAt || isLoadingMore) return
    setIsLoadingMore(true)
    skipAutoScrollRef.current = true
    skipGroupBottomAlignRef.current = true

    const { messages: olderMessages, hasMore: more } = await fetchMessagesPage({
      before: oldestMessageAt,
      clearedAt: clearedAtRef.current,
    })

    if (olderMessages.length === 0) {
      setHasMore(false)
      setIsLoadingMore(false)
      return
    }

    const {
      translations: newTranslations,
      scaled: newScaled,
      corrections: newCorrections,
    } = await fetchMessageEnhancements(olderMessages)
    const mergedTranslations = { ...translations, ...newTranslations }

    setMessages((prev) => [...olderMessages, ...prev])
    setTranslations((prev) => ({ ...prev, ...newTranslations }))
    setScaledTexts((prev) => ({ ...prev, ...newScaled }))
    setMessageCorrections((prev) => ({ ...prev, ...newCorrections }))
    setHasMore(more)
    setOldestMessageAt(olderMessages[0]?.created_at ?? oldestMessageAt)
    queueMissingTranslations(olderMessages, mergedTranslations)
    void resolveAudioUrls(olderMessages)
    void fetchVoiceRenderings(olderMessages.map((msg) => msg.id))
    setIsLoadingMore(false)
  }

  function openCorrectionExplanation(correction: MessageCorrection, fallbackOriginalText: string) {
    setOpenCorrectionDetail({
      originalText: correction.original_text || fallbackOriginalText,
      analysis: analysisFromStoredCorrection(correction),
    })
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 space-y-4 relative scrollbar-slim">
      {loading && visibleMessages.length === 0 ? (
        <div className="space-y-3" aria-label="Loading messages">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className={`flex ${idx % 2 === 0 ? 'justify-start' : 'justify-end'}`}
            >
              <div className="h-4 w-40 rounded-lg bg-gray-200 animate-pulse" />
            </div>
          ))}
        </div>
      ) : visibleMessages.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
          No messages yet. Start the conversation!
        </div>
      ) : null}

      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={loadOlderMessages}
            disabled={isLoadingMore}
            className="rounded-full border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {isLoadingMore ? 'Loading...' : 'Load earlier messages'}
          </button>
        </div>
      )}

      {visibleMessages.map((message) => {
        const isFailed = message.processing_status === 'failed'
        const isOwn = message.sender_id === userId
        const isVoiceMessage = !!message.audio_path
        const isBypass = isBypassMessage(message)
        const rendering = voiceRenderings[message.id]
        const audioUrl = audioUrls[message.id]
        const finalizedVoiceUrl = voiceRenderingAudioUrls[message.id]
        const { displayText, needsTranslation } = resolveMessageDisplay(message)
        const isVoiceRenderingReady =
          !isVoiceMessage ||
          isBypass ||
          isOwn ||
          rendering?.processing_status === 'ready' ||
          rendering?.processing_status === 'failed'

        const canOpenContextMenu = !isFailed && displayText.length > 0 && isVoiceRenderingReady
        const canSpeak =
          !isBypass &&
          !isVoiceMessage &&
          !isFailed &&
          displayText.trim().length > 0
        const showBypassTextLock = isBypass && !isVoiceMessage
        const speechLanguage = resolveSpeechLanguage(message, needsTranslation)
        const isSpeechLoading = loadingSpeechMessageId === message.id
        const isSpeechPlaying = playingSpeechMessageId === message.id
        const voicePlaybackUrl = isVoiceMessage
          ? (
              isBypass
                ? audioUrl
                : isOwn
                  ? finalizedVoiceUrl || audioUrl
                  : rendering?.processing_status === 'ready'
                    ? finalizedVoiceUrl
                    : undefined
            )
          : undefined
        const hasOwnTranscriptText =
          isVoiceMessage &&
          isOwn &&
          !isBypass &&
          message.processing_status === 'ready' &&
          displayText.trim().length > 0
        const hasIncomingTranscriptText =
          isVoiceMessage &&
          !isOwn &&
          (rendering?.processing_status === 'ready' || rendering?.processing_status === 'failed') &&
          displayText.trim().length > 0
        const hasTranscriptText =
          hasOwnTranscriptText || hasIncomingTranscriptText
        const canToggleTranscript =
          hasTranscriptText &&
          !isFailed &&
          (isOwn ? message.processing_status === 'ready' : rendering?.processing_status === 'ready') &&
          displayText.trim().length > 0 &&
          !!voicePlaybackUrl
        const isTranscriptVisible = hasTranscriptText
          ? (canToggleTranscript ? visibleVoiceTranscripts[message.id] === true : true)
          : true
        const senderProfile = isGroup && !isOwn ? senderProfiles[message.sender_id] : null
        const messageTimeLabel = formatMessageTime(message.created_at)
        const correction = isOwn && autoCorrectionEnabled ? messageCorrections[message.id] : undefined
        const correctionAnalysis = correction
          ? analysisFromStoredCorrection(correction)
          : null

        return (
          <div
            key={message.id}
            data-testid="chat-message"
            data-message-id={message.id}
            className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${senderProfile ? 'items-start gap-2' : ''}`}
          >
            {senderProfile && (
              <div className="flex-shrink-0 mt-1">
                {senderProfile.avatar_url ? (
                  <Image
                    src={senderProfile.avatar_url}
                    alt={senderProfile.display_name}
                    width={32}
                    height={32}
                    className="rounded-full object-cover"
                    style={{ width: 32, height: 32 }}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-azure text-white flex items-center justify-center text-sm font-medium">
                    {senderProfile.display_name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            )}
            <div className={`flex max-w-[80%] flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
              <div
                className={`w-fit max-w-full rounded-lg px-4 py-2 ${isOwn
                  ? 'bg-azure text-white'
                  : 'bg-gray-200 text-gray-900'
                  } group`}
                onContextMenu={
                  canOpenContextMenu
                    ? (event) => openContextMenu(event, message, displayText, needsTranslation)
                    : undefined
                }
              >
                {senderProfile && (
                  <p className="text-xs font-medium text-azure mb-1">
                    {senderProfile.display_name}
                  </p>
                )}
                {isVoiceMessage && (
                  voicePlaybackUrl ? (
                    <div className={`${isTranscriptVisible && displayText ? 'mb-2' : ''} ${isOwn ? 'ml-auto' : ''}`}>
                      <VoiceMessagePlayer
                        src={voicePlaybackUrl}
                        isOwn={isOwn}
                        timestampLabel={messageTimeLabel}
                        canToggleTranscript={canToggleTranscript}
                        showLockIndicator={isBypass}
                        isTranscriptVisible={isTranscriptVisible}
                        onToggleTranscript={
                          canToggleTranscript
                            ? () => {
                              setVisibleVoiceTranscripts((prev) => ({
                                ...prev,
                                [message.id]: !prev[message.id],
                              }))
                            }
                            : undefined
                        }
                      />
                    </div>
                  ) : null
                )}
                {isTranscriptVisible && displayText && (
                  <p
                    className="break-words whitespace-pre-wrap text-left"
                  >
                    {displayText}
                  </p>
                )}
                {!isVoiceMessage && (
                  <div className="mt-0.5 flex justify-end">
                    <span className="inline-flex items-center gap-1.5">
                      {canSpeak && (
                        <button
                          type="button"
                          onClick={() => {
                            void toggleSpeech({
                              messageKey: message.id,
                              text: displayText,
                              language: speechLanguage,
                              voice: speechVoice || undefined,
                              rate: speechRate ?? 0,
                            })
                          }}
                          disabled={isSpeechLoading}
                          aria-label={isSpeechPlaying ? 'Stop reading aloud' : 'Read aloud'}
                          title={
                            isSpeechLoading
                              ? 'Loading speech...'
                              : isSpeechPlaying
                                ? 'Stop reading aloud'
                                : 'Read aloud'
                          }
                          className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed ${isOwn
                            ? 'text-white/75 hover:bg-white/20 disabled:text-white/50'
                            : 'text-gray-600 hover:bg-gray-300 dark:text-gray-900/75 dark:hover:bg-gray-700/40 disabled:text-gray-400 dark:disabled:text-gray-600'
                            }`}
                        >
                          {isSpeechLoading ? (
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-30" />
                              <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          ) : isSpeechPlaying ? (
                            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                              <rect x="6" y="5" width="4" height="14" rx="1" />
                              <rect x="14" y="5" width="4" height="14" rx="1" />
                            </svg>
                          ) : (
                            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                              <path d="M14.5 3.4a1 1 0 00-1.08.15L8.8 7H5a1 1 0 00-1 1v8a1 1 0 001 1h3.8l4.62 3.45A1 1 0 0015 19.6V4.4a1 1 0 00-.5-1zM18.7 8.3a1 1 0 011.4 0 5.2 5.2 0 010 7.4 1 1 0 11-1.4-1.42 3.2 3.2 0 000-4.56 1 1 0 010-1.42z" />
                            </svg>
                          )}
                        </button>
                      )}
                      {!canSpeak && showBypassTextLock && (
                        <span
                          className={`flex h-5 w-5 items-center justify-center ${
                            isOwn ? 'text-white/80' : 'text-gray-500'
                          }`}
                          aria-label="Sent as-is"
                          title="Sent as-is"
                        >
                          <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                            <path d="M17 8h-1V6a4 4 0 10-8 0v2H7a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2v-9a2 2 0 00-2-2zm-6 8.73V18a1 1 0 102 0v-1.27a2 2 0 10-2 0zM10 8V6a2 2 0 114 0v2h-4z" />
                          </svg>
                        </span>
                      )}
                      <span className="text-[11px] leading-none opacity-75 whitespace-nowrap text-right">
                        {messageTimeLabel}
                      </span>
                    </span>
                  </div>
                )}
              </div>
              {isOwn && !isBypass && correction && correctionAnalysis && (
                <CorrectionSummary
                  analysis={correctionAnalysis}
                  originalText={correction.original_text || message.original_text || ''}
                  align="right"
                  onOpenDetails={
                    correction.has_issues
                      ? () => openCorrectionExplanation(correction, message.original_text || '')
                      : undefined
                  }
                />
              )}
            </div>
          </div>
        )
      })}
      <CorrectionDetailsModal
        open={openCorrectionDetail !== null}
        onClose={() => setOpenCorrectionDetail(null)}
        analysis={openCorrectionDetail?.analysis || null}
        originalText={openCorrectionDetail?.originalText || ''}
        feedbackLanguage={feedbackLanguage}
      />
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-56 rounded-lg border border-gray-200 bg-white shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Send to Playground
          </div>
          <div className="border-t border-gray-100">
            {CONTEXT_MENU_ACTIONS.map((action) => (
              <button
                key={action.key}
                onClick={() => handleContextAction(action.key)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                role="menuitem"
              >
                <span>{action.label}</span>
                <span className="text-xs text-gray-400">/play/{action.key}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Message View
          </div>
          <div className="border-t border-gray-100">
            <button
              onClick={handleShowUnscaled}
              className="flex w-full items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              role="menuitem"
            >
              <span>Show unscaled text</span>
            </button>
            <button
              onClick={handleShowOriginal}
              className="flex w-full items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              role="menuitem"
            >
              <span>Show original message</span>
            </button>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} className="h-4" />
    </div>
  )
}
