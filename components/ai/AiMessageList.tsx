'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AiChatMessage } from '@/types/database'
import { type AiChatMessageCorrection } from '@/types/correction'
import useEdgeTtsPlayer from '@/hooks/useEdgeTtsPlayer'
import { getAiMessageCache, setAiMessageCache } from '@/lib/chat/aiMessageCache'
import CorrectionSummary from '@/components/correction/CorrectionSummary'
import CorrectionDetailsModal from '@/components/correction/CorrectionDetailsModal'
import {
  analysisFromStoredCorrection,
  fetchAiMessageCorrections,
  upsertAiMessageCorrection,
} from '@/lib/corrections/client'

function formatMessageTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateLabel =
    messageDate.getTime() === today.getTime()
      ? 'Today'
      : date.toLocaleDateString([], { day: 'numeric', month: 'short' })

  return `${timeStr}, ${dateLabel}`
}

export default function AiMessageList({
  sessionId,
  userId,
  feedbackLanguage = 'en',
  autoCorrectionEnabled = true,
  isResponding,
  refreshKey = 0,
  defaultSpeechLanguage = 'en',
  defaultSpeechVoice,
  defaultSpeechRate = 0,
  onHasMessagesChange,
}: {
  sessionId: string
  userId: string
  feedbackLanguage?: string
  autoCorrectionEnabled?: boolean
  isResponding: boolean
  refreshKey?: number
  defaultSpeechLanguage?: string
  defaultSpeechVoice?: string | null
  defaultSpeechRate?: number | null
  onHasMessagesChange?: (hasMessages: boolean) => void
}) {
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [corrections, setCorrections] = useState<Record<string, AiChatMessageCorrection>>({})
  const [openCorrectionDetail, setOpenCorrectionDetail] = useState<{
    originalText: string
    analysis: ReturnType<typeof analysisFromStoredCorrection>
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageIdSetRef = useRef<Set<string>>(new Set())
  const processedCorrectionsRef = useRef<Set<string>>(new Set())
  const feedbackLanguageRef = useRef(feedbackLanguage)
  const autoCorrectionEnabledRef = useRef(autoCorrectionEnabled)
  const correctionsRef = useRef<Record<string, AiChatMessageCorrection>>({})
  const {
    loadingMessageId: loadingSpeechMessageId,
    playingMessageId: playingSpeechMessageId,
    toggleSpeech,
  } = useEdgeTtsPlayer()

  useEffect(() => {
    feedbackLanguageRef.current = feedbackLanguage || 'en'
  }, [feedbackLanguage])

  useEffect(() => {
    autoCorrectionEnabledRef.current = autoCorrectionEnabled
  }, [autoCorrectionEnabled])

  useEffect(() => {
    messageIdSetRef.current = new Set(messages.map((message) => message.id))
  }, [messages])

  useEffect(() => {
    correctionsRef.current = corrections
  }, [corrections])

  const queueMissingCorrections = useCallback((messagesToCheck: AiChatMessage[]) => {
    if (!autoCorrectionEnabledRef.current) {
      return
    }

    messagesToCheck.forEach((message) => {
      if (message.role !== 'user' || !message.content.trim()) {
        return
      }

      if (correctionsRef.current[message.id] || processedCorrectionsRef.current.has(message.id)) {
        return
      }

      processedCorrectionsRef.current.add(message.id)

      void upsertAiMessageCorrection({
        aiMessageId: message.id,
        userId,
        text: message.content,
        feedbackLanguage: feedbackLanguageRef.current || 'en',
        source: 'AiMessageList.queueMissingCorrections',
      })
        .then((correction) => {
          if (!correction) return
          setCorrections((prev) => ({
            ...prev,
            [message.id]: correction,
          }))
        })
        .catch((error) => {
          processedCorrectionsRef.current.delete(message.id)
          console.error('[AiMessageList] Failed to create correction:', error)
        })
    })
  }, [userId])

  useEffect(() => {
    const cached = getAiMessageCache(sessionId)
    const timer = setTimeout(() => {
      setMessages(cached?.messages ?? [])
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [sessionId])

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`ai-chat-messages:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ai_chat_messages',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const newMessage = payload.new as AiChatMessage
          // Only generate corrections for new realtime user messages.
          if (newMessage.role === 'user' && !messageIdSetRef.current.has(newMessage.id)) {
            queueMissingCorrections([newMessage])
          }
          setMessages((prev) => {
            if (prev.some((msg) => msg.id === newMessage.id)) {
              return prev
            }
            const next = [...prev, newMessage]
            setAiMessageCache(sessionId, next, { isComplete: true })
            return next
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ai_chat_message_corrections',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!autoCorrectionEnabledRef.current) {
            return
          }
          const row = payload.new as AiChatMessageCorrection
          if (!messageIdSetRef.current.has(row.ai_message_id)) {
            return
          }
          processedCorrectionsRef.current.add(row.ai_message_id)
          setCorrections((prev) => ({
            ...prev,
            [row.ai_message_id]: row,
          }))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ai_chat_message_corrections',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!autoCorrectionEnabledRef.current) {
            return
          }
          const row = payload.new as AiChatMessageCorrection
          if (!messageIdSetRef.current.has(row.ai_message_id)) {
            return
          }
          processedCorrectionsRef.current.add(row.ai_message_id)
          setCorrections((prev) => ({
            ...prev,
            [row.ai_message_id]: row,
          }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, userId, queueMissingCorrections])

  useEffect(() => {
    const supabase = createClient()

    async function loadMessages() {
      processedCorrectionsRef.current.clear()
      setCorrections({})

      const { data, error } = await supabase
        .from('ai_chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })

      if (!error && data) {
        const nextMessages = data as AiChatMessage[]
        setMessages(nextMessages)
        setAiMessageCache(sessionId, nextMessages, { isComplete: true })

        const userMessageIds = nextMessages
          .filter((message) => message.role === 'user')
          .map((message) => message.id)

        if (autoCorrectionEnabled && userMessageIds.length > 0) {
          try {
            const existingCorrections = await fetchAiMessageCorrections({
              aiMessageIds: userMessageIds,
              userId,
            })
            Object.keys(existingCorrections).forEach((messageId) => {
              processedCorrectionsRef.current.add(messageId)
            })
            setCorrections(existingCorrections)
          } catch (fetchError) {
            console.error('[AiMessageList] Failed to fetch corrections:', fetchError)
            setCorrections({})
          }
        } else {
          setCorrections({})
        }

      } else {
        setCorrections({})
      }
    }

    loadMessages()
  }, [sessionId, refreshKey, userId, autoCorrectionEnabled])

  useLayoutEffect(() => {
    if (messages.length === 0 && !isResponding) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages.length, isResponding])

  useEffect(() => {
    onHasMessagesChange?.(messages.length > 0)
  }, [messages.length, onHasMessagesChange])

  function openCorrectionExplanation(correction: AiChatMessageCorrection, fallbackOriginalText: string) {
    setOpenCorrectionDetail({
      originalText: correction.original_text || fallbackOriginalText,
      analysis: analysisFromStoredCorrection(correction),
    })
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 space-y-4 scrollbar-slim">
      {messages.length === 0 && (
        <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
          No messages yet. Start the conversation!
        </div>
      )}

      {messages.map((message) => {
        const isUser = message.role === 'user'
        const isSpeechLoading = loadingSpeechMessageId === message.id
        const isSpeechPlaying = playingSpeechMessageId === message.id
        const correction = isUser && autoCorrectionEnabled ? corrections[message.id] : undefined
        const correctionAnalysis = correction
          ? analysisFromStoredCorrection(correction)
          : null

        return (
          <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[80%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
              <div
                className={`w-fit max-w-full rounded-lg px-4 py-2 ${isUser ? 'bg-azure text-white' : 'bg-gray-200 text-gray-900'
                  } group`}
              >
                <p className="break-words whitespace-pre-wrap">{message.content}</p>
                <div className="mt-1 flex justify-end">
                  <span className="inline-flex items-center gap-1.5">
                    {message.content.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          void toggleSpeech({
                            messageKey: message.id,
                            text: message.content,
                            language: defaultSpeechLanguage,
                            voice: defaultSpeechVoice || undefined,
                            rate: defaultSpeechRate ?? 0,
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
                        className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed ${
                          isUser
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
                    <span className="text-xs opacity-75 whitespace-nowrap text-right">
                      {formatMessageTime(message.created_at)}
                    </span>
                  </span>
                </div>
              </div>
              {isUser && correction && correctionAnalysis && (
                <CorrectionSummary
                  analysis={correctionAnalysis}
                  originalText={correction.original_text || message.content}
                  align="right"
                  onOpenDetails={
                    correction.has_issues
                      ? () => openCorrectionExplanation(correction, message.content)
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

      {isResponding && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-lg px-4 py-2 bg-gray-200 text-gray-900">
            <p className="text-sm italic text-gray-600">Thinking...</p>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} className="h-4" />
    </div>
  )
}
