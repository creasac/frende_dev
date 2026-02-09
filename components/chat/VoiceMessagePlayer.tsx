'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

function formatPlaybackTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '--:--'
  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function buildWaveformLevels(seed: string, count = 30): number[] {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }

  const levels: number[] = []
  let value = Math.abs(hash) + 1
  for (let i = 0; i < count; i += 1) {
    value = (value * 1664525 + 1013904223) % 0x100000000
    const normalized = value / 0x100000000
    // Height range: 25-75% for slightly taller bars
    levels.push(25 + Math.round(normalized * 50))
  }
  return levels
}

export default function VoiceMessagePlayer({
  src,
  isOwn,
  timestampLabel,
  canToggleTranscript = false,
  isTranscriptVisible = true,
  onToggleTranscript,
  showLockIndicator = false,
}: {
  src: string
  isOwn: boolean
  timestampLabel?: string
  canToggleTranscript?: boolean
  isTranscriptVisible?: boolean
  onToggleTranscript?: () => void
  showLockIndicator?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const waveformLevels = useMemo(() => buildWaveformLevels(src), [src])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)

    if (audio.readyState >= 1) {
      onLoadedMetadata()
    }

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [src])

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio) return

    if (audio.paused) {
      try {
        await audio.play()
      } catch (error) {
        console.error('[VoiceMessagePlayer] Failed to play audio:', error)
      }
      return
    }

    audio.pause()
  }

  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0
  const displayedTime = isPlaying ? currentTime : duration
  const ownMetaTone = 'text-white/75'
  const incomingMetaTone = 'text-gray-600 dark:text-gray-900/75'

  return (
    <div className="w-56 max-w-full">
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="grid grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto] gap-x-2.5 gap-y-1.5">
        {/* Play/Pause button - triangle only, no circle, sized between old triangle and circle */}
        <button
          type="button"
          onClick={togglePlayback}
          className={`row-start-1 col-start-1 flex h-6 w-6 flex-shrink-0 items-center justify-center self-center ${
            isOwn ? ownMetaTone : incomingMetaTone
          }`}
          aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
              <path d="M6 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 6 4.5z" />
            </svg>
          )}
        </button>

        {/* Waveform bars - lean width */}
        <div className="row-start-1 col-start-2 min-w-0 flex items-center">
          <div className="flex h-6 w-full items-center justify-between">
            {waveformLevels.map((level, index) => {
              const ratio = (index + 1) / waveformLevels.length
              const isActive = ratio <= progress
              const barColor = isOwn
                ? (isActive ? 'bg-white dark:bg-gray-950' : 'bg-white/35 dark:bg-gray-700/55')
                : (isActive ? 'bg-gray-600 dark:bg-gray-950' : 'bg-gray-400 dark:bg-gray-700/55')

              return (
                <span
                  key={index}
                  className={`w-[2px] flex-shrink-0 rounded-full ${barColor}`}
                  style={{
                    height: `${level}%`,
                  }}
                />
              )
            })}
          </div>
        </div>

        <p className={`row-start-2 col-start-1 text-center text-[11px] leading-none ${isOwn ? 'text-white/85' : incomingMetaTone}`}>
          {formatPlaybackTime(displayedTime)}
        </p>

        {(timestampLabel || canToggleTranscript || showLockIndicator) && (
          <div
            className="row-start-2 col-start-2 flex min-w-0 items-center justify-end gap-2"
          >
            {canToggleTranscript && onToggleTranscript && (
              <button
                type="button"
                onClick={onToggleTranscript}
                className={`flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[9px] font-semibold leading-none transition-colors ${isOwn
                  ? isTranscriptVisible
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:bg-white/15'
                  : isTranscriptVisible
                    ? 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-200'
                    : 'text-gray-600 dark:text-gray-900/75 hover:bg-gray-300 dark:hover:bg-gray-700/40'
                  }`}
                aria-label={isTranscriptVisible ? 'Hide transcript' : 'Show transcript'}
                title={isTranscriptVisible ? 'Hide transcript' : 'Show transcript'}
              >
                CC
              </button>
            )}
            {!canToggleTranscript && showLockIndicator && (
              <span
                className={`flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1.5 ${
                  isOwn ? 'text-white/80' : incomingMetaTone
                }`}
                aria-label="Sent as-is"
                title="Sent as-is"
              >
                <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                  <path d="M17 8h-1V6a4 4 0 10-8 0v2H7a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2v-9a2 2 0 00-2-2zm-6 8.73V18a1 1 0 102 0v-1.27a2 2 0 10-2 0zM10 8V6a2 2 0 114 0v2h-4z" />
                </svg>
              </span>
            )}
            {timestampLabel && (
              <span
                className={`min-w-0 truncate text-[11px] leading-none text-right ${isOwn ? ownMetaTone : incomingMetaTone}`}
              >
                {timestampLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
