'use client'

import { useEffect, useMemo, useState } from 'react'
import TemporaryAiMessageList, { type TemporaryAiMessage } from '@/components/ai/TemporaryAiMessageList'
import TemporaryAiMessageInput from '@/components/ai/TemporaryAiMessageInput'
import CorrectionDetailsModal from '@/components/correction/CorrectionDetailsModal'
import { postJsonWithRetry } from '@/lib/ai/apiRequestQueue'
import { createClient } from '@/lib/supabase/client'
import { type CorrectionAnalysis } from '@/types/correction'
import {
  requestCorrectionAnalysis,
} from '@/lib/corrections/client'

type TemporaryAiResponse = {
  content: string
}

function createMessageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function HomeAiChat() {
  const [messages, setMessages] = useState<TemporaryAiMessage[]>([])
  const [isResponding, setIsResponding] = useState(false)
  const [error, setError] = useState('')
  const [feedbackLanguage, setFeedbackLanguage] = useState('en')
  const [autoCorrectionEnabled, setAutoCorrectionEnabled] = useState(true)
  const [openCorrectionDetail, setOpenCorrectionDetail] = useState<{
    originalText: string
    analysis: CorrectionAnalysis
  } | null>(null)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    async function loadCorrectionPreferences() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('feedback_language, language_preference, auto_correction_enabled')
        .eq('id', user.id)
        .single()

      if (profile?.feedback_language || profile?.language_preference) {
        setFeedbackLanguage(profile.feedback_language || profile.language_preference || 'en')
      }

      if (typeof profile?.auto_correction_enabled === 'boolean') {
        setAutoCorrectionEnabled(profile.auto_correction_enabled)
      }
    }

    loadCorrectionPreferences()
  }, [supabase])

  async function runCorrectionForTemporaryMessage(messageId: string, text: string) {
    try {
      const analysis = await requestCorrectionAnalysis({
        text,
        feedbackLanguage,
        source: 'HomeAiChat.runCorrectionForTemporaryMessage',
      })

      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? {
                ...message,
                correction: {
                  status: 'ready',
                  analysis,
                },
              }
            : message
        )
      )
    } catch (correctionError) {
      console.error('[HomeAiChat] Failed to get correction:', correctionError)
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? {
                ...message,
                correction: {
                  status: 'failed',
                },
              }
            : message
        )
      )
    }
  }

  async function handleSend(content: string): Promise<boolean> {
    const trimmed = content.trim()
    if (!trimmed || isResponding) return false

    const userMessage: TemporaryAiMessage = {
      id: createMessageId(),
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
      ...(autoCorrectionEnabled
        ? {
            correction: {
              status: 'pending' as const,
            },
          }
        : {}),
    }

    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setIsResponding(true)
    setError('')
    if (autoCorrectionEnabled) {
      void runCorrectionForTemporaryMessage(userMessage.id, trimmed)
    }

    try {
      const response = await postJsonWithRetry<TemporaryAiResponse>(
        '/api/ai-chat/temporary',
        {
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        },
        { source: 'HomeAiChat' }
      )

      const reply = response.content?.trim()
      if (!reply) {
        throw new Error('Empty response from AI')
      }

      const assistantMessage: TemporaryAiMessage = {
        id: createMessageId(),
        role: 'assistant',
        content: reply,
        created_at: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, assistantMessage])
      return true
    } catch (err) {
      console.error('[HomeAiChat] Failed to send message:', err)
      setError('Failed to reach frende AI. Please try again.')
      return false
    } finally {
      setIsResponding(false)
    }
  }

  function openTemporaryCorrection(messageId: string) {
    if (!autoCorrectionEnabled) {
      return
    }

    const message = messages.find((item) => item.id === messageId)
    if (!message || message.correction?.status !== 'ready' || !message.correction.analysis) {
      return
    }

    setOpenCorrectionDetail({
      originalText: message.content,
      analysis: message.correction.analysis,
    })
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {error && (
        <div className="border-b bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {messages.length > 0 && (
        <div className="px-6 pt-6">
          <span className="text-lg font-semibold text-gray-900">frende</span>
        </div>
      )}

      <TemporaryAiMessageList
        messages={messages}
        isResponding={isResponding}
        hasHeader={messages.length > 0}
        onOpenCorrection={openTemporaryCorrection}
      />
      <TemporaryAiMessageInput
        onSend={handleSend}
        disabled={isResponding}
      />
      <CorrectionDetailsModal
        open={openCorrectionDetail !== null}
        onClose={() => setOpenCorrectionDetail(null)}
        analysis={openCorrectionDetail?.analysis || null}
        originalText={openCorrectionDetail?.originalText || ''}
        feedbackLanguage={feedbackLanguage}
      />
    </div>
  )
}
