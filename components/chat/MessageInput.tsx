'use client'

import { useState, useRef, useEffect } from 'react'
import { sendMessage, sendVoiceMessage } from '@/lib/chat/messages'
import { upsertMessageCorrection } from '@/lib/corrections/client'

function getErrorMessage(error: unknown): string {
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

export default function MessageInput({
  conversationId,
  userId,
  userLanguage,
  feedbackLanguage = 'en',
  autoCorrectionEnabled = true,
}: {
  conversationId: string
  userId: string
  userLanguage: string
  feedbackLanguage?: string
  autoCorrectionEnabled?: boolean
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [bypassByConversation, setBypassByConversation] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const maxInputHeight = 120
  const bypassRecipientSettings = bypassByConversation[conversationId] === true

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!isRecording) {
        inputRef.current?.focus()
      }
    })
    return () => cancelAnimationFrame(id)
  }, [conversationId, isRecording])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const nextHeight = Math.min(el.scrollHeight, maxInputHeight)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxInputHeight ? 'auto' : 'hidden'
  }, [text, maxInputHeight])

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    try {
      const sentMessage = await sendMessage(conversationId, userId, 'text', {
        text: trimmed,
        language: userLanguage,
        bypassRecipientPreferences: bypassRecipientSettings,
      })

      if (autoCorrectionEnabled && !bypassRecipientSettings) {
        void upsertMessageCorrection({
          messageId: sentMessage.id,
          userId,
          text: trimmed,
          feedbackLanguage,
          source: 'MessageInput.handleSend',
        }).catch((error) => {
          console.error('[MessageInput] Failed to create message correction:', error)
        })
      }

      setText('')
    } catch (error) {
      const message = getErrorMessage(error)
      console.error('Failed to send message:', message, error)
      alert(`Failed to send message: ${message}`)
    } finally {
      setSending(false)
    }
  }

  async function handleVoiceSend(blob: Blob) {
    if (blob.size === 0 || sending) {
      return
    }

    setSending(true)
    try {
      await sendVoiceMessage(conversationId, userId, {
        audio: blob,
        bypassRecipientPreferences: bypassRecipientSettings,
      })
    } catch (error) {
      const message = getErrorMessage(error)
      console.error('[MessageInput] Failed to send voice message:', message, error)
      alert(`Failed to send voice message: ${message}`)
    } finally {
      setSending(false)
      setRecordingTime(0)
      audioChunksRef.current = []
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      })

      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        await handleVoiceSend(blob)
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1)
      }, 1000)
    } catch (error) {
      console.error('Failed to start recording:', error)
      alert('Failed to access microphone. Please check permissions.')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="px-4 pt-2 pb-4">
      {isRecording && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-red-50 p-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 animate-pulse rounded-full bg-red-500"></div>
            <span className="text-sm font-medium text-red-600">
              Recording... {formatTime(recordingTime)}
            </span>
          </div>
          <button
            onClick={stopRecording}
            className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
          >
            Stop
          </button>
        </div>
      )}

      <form onSubmit={handleSend} className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() =>
            setBypassByConversation((prev) => ({
              ...prev,
              [conversationId]: !(prev[conversationId] === true),
            }))
          }
          disabled={sending || isRecording}
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
            bypassRecipientSettings
              ? 'border-amber-500 bg-amber-100 text-amber-700 hover:bg-amber-200'
              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
          } disabled:cursor-not-allowed disabled:opacity-50`}
          title={
            bypassRecipientSettings
              ? 'As-is send enabled. Recipients get original message.'
              : 'Enable as-is send. Bypass recipient settings.'
          }
          aria-pressed={bypassRecipientSettings}
          aria-label="Toggle as-is send mode"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            {bypassRecipientSettings ? (
              <path d="M17 8h-1V6a4 4 0 10-8 0v2H7a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2v-9a2 2 0 00-2-2zm-6 8.73V18a1 1 0 102 0v-1.27a2 2 0 10-2 0zM10 8V6a2 2 0 114 0v2h-4z" />
            ) : (
              <path d="M17 8h-1V6a4 4 0 10-8 0h2a2 2 0 114 0v2H7a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2v-9a2 2 0 00-2-2zm-6 8.73V18a1 1 0 102 0v-1.27a2 2 0 10-2 0z" />
            )}
          </svg>
        </button>
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={sending}
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${isRecording
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            } disabled:bg-gray-400`}
          title={isRecording ? 'Stop recording' : 'Record audio'}
        >
          {isRecording ? (
            <svg
              className="h-5 w-5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg
              className="h-5 w-5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleSend()
            }
          }}
          placeholder="hello frende..."
          disabled={sending || isRecording}
          rows={1}
          ref={inputRef}
          autoFocus
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          className="flex-1 max-w-2xl min-h-12 max-h-[120px] resize-none rounded-full border-2 px-5 py-3 leading-5 focus:outline-none focus:ring-2 focus:ring-azure"
          style={{ borderColor: isInputFocused ? 'var(--azure-blue)' : 'var(--color-gray-400)' }}
        />
        <button
          type="submit"
          disabled={sending || !text.trim() || isRecording}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-azure text-white hover:bg-azure/90 disabled:bg-gray-400"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </form>
    </div>
  )
}
