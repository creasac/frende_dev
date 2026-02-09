'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type TtsRequest = {
  text: string
  language?: string
  voice?: string
  rate?: number
}

type ToggleSpeechInput = TtsRequest & {
  messageKey: string
}

function buildCacheKey(payload: TtsRequest): string {
  return JSON.stringify(payload)
}

export default function useEdgeTtsPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlCacheRef = useRef<Map<string, string>>(new Map())
  const inFlightUrlRequestsRef = useRef<Map<string, Promise<string>>>(new Map())
  const abortControllerRef = useRef<AbortController | null>(null)
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null)
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)

  const stopSpeech = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setLoadingMessageId(null)

    const currentAudio = audioRef.current
    if (currentAudio) {
      currentAudio.pause()
      currentAudio.currentTime = 0
      currentAudio.onplay = null
      currentAudio.onpause = null
      currentAudio.onended = null
      currentAudio.onerror = null
      audioRef.current = null
    }

    setPlayingMessageId(null)
  }, [])

  useEffect(() => {
    const objectUrlCache = objectUrlCacheRef.current
    const inFlightUrlRequests = inFlightUrlRequestsRef.current

    return () => {
      stopSpeech()
      for (const objectUrl of objectUrlCache.values()) {
        URL.revokeObjectURL(objectUrl)
      }
      objectUrlCache.clear()
      inFlightUrlRequests.clear()
    }
  }, [stopSpeech])

  const fetchAudioUrl = useCallback(async (
    payload: TtsRequest,
    options?: { signal?: AbortSignal }
  ): Promise<string> => {
    const cacheKey = buildCacheKey(payload)
    const cachedUrl = objectUrlCacheRef.current.get(cacheKey)
    if (cachedUrl) {
      return cachedUrl
    }

    const inFlight = inFlightUrlRequestsRef.current.get(cacheKey)
    if (inFlight) {
      return inFlight
    }

    const requestPromise = (async () => {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: options?.signal,
      })

      if (!response.ok) {
        const errorResponse = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(errorResponse?.error || `Failed to generate TTS audio (${response.status})`)
      }

      const blob = await response.blob()
      if (blob.size === 0) {
        throw new Error('Generated TTS audio is empty')
      }

      const objectUrl = URL.createObjectURL(blob)
      objectUrlCacheRef.current.set(cacheKey, objectUrl)
      return objectUrl
    })()

    inFlightUrlRequestsRef.current.set(cacheKey, requestPromise)

    try {
      return await requestPromise
    } finally {
      inFlightUrlRequestsRef.current.delete(cacheKey)
    }
  }, [])

  const toggleSpeech = useCallback(async (input: ToggleSpeechInput) => {
    const text = input.text.trim()
    if (!text) {
      return
    }

    if (playingMessageId === input.messageKey || loadingMessageId === input.messageKey) {
      stopSpeech()
      return
    }

    stopSpeech()
    setLoadingMessageId(input.messageKey)
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const audioUrl = await fetchAudioUrl({
        text,
        language: input.language,
        voice: input.voice,
        rate: input.rate,
      }, { signal: abortController.signal })

      const audio = new Audio(audioUrl)
      audioRef.current = audio

      audio.onplay = () => {
        setPlayingMessageId(input.messageKey)
      }

      audio.onpause = () => {
        setPlayingMessageId((current) => (current === input.messageKey ? null : current))
      }

      audio.onended = () => {
        setPlayingMessageId((current) => (current === input.messageKey ? null : current))
      }

      audio.onerror = () => {
        setPlayingMessageId((current) => (current === input.messageKey ? null : current))
      }

      await audio.play()
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('[useEdgeTtsPlayer] Failed to play TTS audio:', error)
      }
    } finally {
      setLoadingMessageId((current) => (current === input.messageKey ? null : current))
    }
  }, [fetchAudioUrl, loadingMessageId, playingMessageId, stopSpeech])

  return {
    getAudioUrl: fetchAudioUrl,
    loadingMessageId,
    playingMessageId,
    stopSpeech,
    toggleSpeech,
  }
}
