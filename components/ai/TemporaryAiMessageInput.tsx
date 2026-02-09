'use client'

import { useEffect, useRef, useState } from 'react'
import { transcribeAudioWithRetry } from '@/lib/ai/transcriptionQueue'

export default function TemporaryAiMessageInput({
  onSend,
  disabled,
}: {
  onSend: (content: string) => Promise<boolean>
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [error, setError] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [transcribedText, setTranscribedText] = useState('')
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [showTranscription, setShowTranscription] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const maxInputHeight = 120

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
      if (!disabled && !isRecording && !showTranscription) {
        inputRef.current?.focus()
      }
    })
    return () => cancelAnimationFrame(id)
  }, [disabled, isRecording, showTranscription])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const nextHeight = Math.min(el.scrollHeight, maxInputHeight)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxInputHeight ? 'auto' : 'hidden'
  }, [text, maxInputHeight])

  async function transcribeAudio(blob: Blob): Promise<string> {
    try {
      return await transcribeAudioWithRetry(blob, {
        language: 'auto',
        source: 'TemporaryAiMessageInput',
        persist: true,
      })
    } catch (error) {
      console.error('[TemporaryAiMessageInput] Transcription error:', error)
      return ''
    }
  }

  async function sendMessageContent(content: string): Promise<boolean> {
    const trimmed = content.trim()
    if (!trimmed || sending || disabled) return false

    setSending(true)
    setError('')

    try {
      const sent = await onSend(trimmed)
      if (!sent) {
        setError('Failed to send message')
      }
      return sent
    } catch (err) {
      console.error('[TemporaryAiMessageInput] Send error:', err)
      setError(err instanceof Error ? err.message : 'Failed to send message')
      return false
    } finally {
      setSending(false)
    }
  }

  async function handleSend() {
    const currentText = text
    if (!currentText.trim() || sending || disabled) {
      return
    }
    setText('')
    await sendMessageContent(currentText)
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
      setTranscribedText('')
      setShowTranscription(false)

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        setIsTranscribing(true)
        setShowTranscription(true)
        try {
          const transcription = await transcribeAudio(blob)
          setTranscribedText(transcription)
        } catch (error) {
          console.error('[TemporaryAiMessageInput] Transcription failed:', error)
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)

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

  function cancelTranscription() {
    setTranscribedText('')
    setShowTranscription(false)
    setRecordingTime(0)
    setIsTranscribing(false)
    audioChunksRef.current = []
  }

  async function sendTranscribedMessage() {
    const currentText = transcribedText
    if (!currentText.trim() || sending || disabled || isTranscribing) {
      return
    }
    setTranscribedText('')
    setShowTranscription(false)
    setRecordingTime(0)
    audioChunksRef.current = []
    await sendMessageContent(currentText)
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="px-4 pt-2 pb-4">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {showTranscription && !isRecording && (
        <div className="mb-2 rounded-lg bg-gray-100 p-2">
          {isTranscribing ? (
            <div className="mb-2 rounded bg-white p-2">
              <p className="text-xs text-gray-500 mb-1">Transcribing with Gemini...</p>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-azure border-t-transparent"></div>
                <span className="text-sm text-gray-500">Processing audio...</span>
              </div>
            </div>
          ) : transcribedText ? (
            <div className="mb-2 rounded bg-white p-2">
              <p className="text-xs text-gray-500 mb-1">Transcription:</p>
              <p className="text-sm text-gray-800">{transcribedText}</p>
            </div>
          ) : (
            <div className="mb-2 rounded bg-white p-2">
              <p className="text-sm text-gray-500">No speech detected. Try again.</p>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={cancelTranscription}
              className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-200"
              disabled={isTranscribing}
            >
              Cancel
            </button>
            <button
              onClick={sendTranscribedMessage}
              disabled={sending || isTranscribing || !transcribedText.trim() || disabled}
              className="rounded bg-azure p-1.5 text-white hover:bg-azure/90 disabled:bg-gray-400"
            >
              {sending ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

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

      <form onSubmit={(event) => { event.preventDefault(); handleSend() }} className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={disabled || sending || showTranscription}
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${isRecording
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            } disabled:bg-gray-400`}
          title={isRecording ? 'Stop recording' : 'Record audio'}
        >
          {isRecording ? (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
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
          placeholder={disabled ? 'Waiting for AI response...' : 'hello frende...'}
          disabled={disabled || sending || isRecording || showTranscription}
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
          disabled={disabled || sending || !text.trim() || isRecording || showTranscription}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-azure text-white hover:bg-azure/90 disabled:bg-gray-400"
        >
          {sending ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          )}
        </button>
      </form>
    </div>
  )
}
