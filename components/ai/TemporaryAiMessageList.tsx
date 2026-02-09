'use client'

import { useEffect, useRef } from 'react'
import MarkdownMessage from './MarkdownMessage'
import CorrectionSummary from '@/components/correction/CorrectionSummary'
import { type CorrectionAnalysis } from '@/types/correction'

export type TemporaryAiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  correction?: {
    status: 'pending' | 'ready' | 'failed'
    analysis?: CorrectionAnalysis
  }
}

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

export default function TemporaryAiMessageList({
  messages,
  isResponding,
  hasHeader = false,
  onOpenCorrection,
}: {
  messages: TemporaryAiMessage[]
  isResponding: boolean
  hasHeader?: boolean
  onOpenCorrection?: (messageId: string) => void
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isResponding])

  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4 scrollbar-slim ${hasHeader ? 'pt-4' : 'pt-6'}`}
      data-testid="temp-ai-list"
    >
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center" data-testid="temp-ai-empty">
          <div className="text-center">
            <h1 className="text-4xl sm:text-5xl font-semibold text-gray-900">frende</h1>
            <p className="mt-2 text-[20px] text-gray-500">talk with anyone, anywhere</p>
          </div>
        </div>
      ) : (
        <>
          {messages.map((message) => {
            const isUser = message.role === 'user'
            return (
              <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`} data-testid="temp-ai-message">
                <div className={`flex max-w-[80%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`w-fit max-w-[100%] rounded-2xl px-4 py-2 ${
                      isUser ? 'bg-azure text-white' : 'bg-gray-200 text-gray-900'
                    }`}
                  >
                    {isUser ? (
                      <p className="break-words whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <MarkdownMessage content={message.content} className="text-sm" />
                    )}
                    <div className="mt-1 text-xs opacity-75 text-right">
                      {formatMessageTime(message.created_at)}
                    </div>
                  </div>
                  {isUser && message.correction?.status === 'ready' && message.correction.analysis && (
                    <CorrectionSummary
                      analysis={message.correction.analysis}
                      originalText={message.content}
                      align="right"
                      onOpenDetails={
                        onOpenCorrection
                          ? () => onOpenCorrection(message.id)
                          : undefined
                      }
                    />
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}

      {isResponding && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-gray-200 text-gray-900">
            <p className="text-sm italic text-gray-600">Thinking...</p>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} className="h-4" />
    </div>
  )
}
