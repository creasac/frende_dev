'use client'

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { transcribeAudioWithRetry } from '@/lib/ai/transcriptionQueue'
import { postJsonWithRetry } from '@/lib/ai/apiRequestQueue'
import { clearFocusedCorrection, loadFocusedCorrection } from '@/lib/corrections/client'

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ne', name: 'Nepali' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
]

type FeatureKey = 'translate' | 'alternatives' | 'correction' | 'scale'

type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced'

const DEFAULT_FEATURE: FeatureKey = 'translate'
const FEATURE_KEYS: FeatureKey[] = ['translate', 'alternatives', 'correction', 'scale']
const PLAYGROUND_STORAGE_KEY = 'playgroundDraftText'

interface ScaleResult {
  original: string
  scaledText: string
  targetLevel: ProficiencyLevel
  originalLevel: string
  wasScaled: boolean
  changes: string[]
}

interface Issue {
  type: 'grammar' | 'spelling' | 'word_choice' | 'punctuation' | 'style'
  original: string
  correction: string
  explanation: string
  position: string
}

interface WordSuggestion {
  original: string
  alternatives: string[]
  reason: string
}

interface Correction {
  correctedSentence: string
  overallScore: number
  issues: Issue[]
  wordSuggestions: WordSuggestion[]
  praise: string
  tip: string
}

interface FeatureOption {
  key: FeatureKey
  label: string
  actionLabel: string
  loadingLabel: string
  icon: ReactElement
}

const FEATURE_OPTIONS: FeatureOption[] = [
  {
    key: 'translate',
    label: 'Translate',
    actionLabel: 'Translate',
    loadingLabel: 'Translating...',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
        />
      </svg>
    ),
  },
  {
    key: 'alternatives',
    label: 'Alternatives',
    actionLabel: 'Get Alternatives',
    loadingLabel: 'Getting alternatives...',
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <defs>
          <marker
            id="alternatives-arrowhead"
            markerWidth="4"
            markerHeight="4"
            refX="4"
            refY="2"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0 0L6 2L0 4Z" fill="currentColor" />
          </marker>
        </defs>
        <circle cx="3.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <line x1="5" y1="12" x2="8" y2="12" strokeWidth={2} strokeLinecap="round" />
        <line x1="8" y1="12" x2="20" y2="12" strokeWidth={2} strokeLinecap="round" markerEnd="url(#alternatives-arrowhead)" />
        <line x1="8" y1="12" x2="17" y2="5" strokeWidth={2} strokeLinecap="round" markerEnd="url(#alternatives-arrowhead)" />
        <line x1="8" y1="12" x2="17" y2="19" strokeWidth={2} strokeLinecap="round" markerEnd="url(#alternatives-arrowhead)" />
      </svg>
    ),
  },
  {
    key: 'correction',
    label: 'Correction',
    actionLabel: 'Get Corrections',
    loadingLabel: 'Correcting...',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    key: 'scale',
    label: 'Scale',
    actionLabel: 'Scale Text',
    loadingLabel: 'Scaling...',
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M6 18V14H10V10H14V6H18V18H6Z"
        />
      </svg>
    ),
  },
]

const TRANSLATION_LABELS = {
  direct: { label: 'Translation', description: 'Accurate and natural' },
  formal: { label: 'Formal', description: 'Professional tone' },
  casual: { label: 'Casual', description: 'Friendly and conversational' },
}

const ALTERNATIVE_LABELS = [
  { label: 'Professional', description: 'More polished and formal' },
  { label: 'Friendly', description: 'More casual and approachable' },
  { label: 'Concise', description: 'More clear and to the point' },
]

const LEVEL_INFO: Record<ProficiencyLevel, { label: string; description: string }> = {
  beginner: { label: 'Beginner', description: 'A1-A2: Simple vocabulary, short sentences' },
  intermediate: { label: 'Intermediate', description: 'B1-B2: Balanced complexity, some idioms' },
  advanced: { label: 'Advanced', description: 'C1-C2: Sophisticated, nuanced language' },
}

export default function PlaygroundClient() {
  const [text, setText] = useState('')
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [targetLanguage, setTargetLanguage] = useState('en')
  const [feedbackLanguage, setFeedbackLanguage] = useState('en')
  const [targetLevel, setTargetLevel] = useState<ProficiencyLevel>('beginner')
  const [translations, setTranslations] = useState<{
    direct: string
    formal: string
    casual: string
  } | null>(null)
  const [alternatives, setAlternatives] = useState<string[]>([])
  const [correction, setCorrection] = useState<Correction | null>(null)
  const [scaleResult, setScaleResult] = useState<ScaleResult | null>(null)
  const [translateLoading, setTranslateLoading] = useState(false)
  const [alternativesLoading, setAlternativesLoading] = useState(false)
  const [correctionLoading, setCorrectionLoading] = useState(false)
  const [scaleLoading, setScaleLoading] = useState(false)
  const [translateError, setTranslateError] = useState('')
  const [alternativesError, setAlternativesError] = useState('')
  const [correctionError, setCorrectionError] = useState('')
  const [scaleError, setScaleError] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [copiedCorrected, setCopiedCorrected] = useState(false)
  const [copiedScaled, setCopiedScaled] = useState(false)
  const [userLanguage, setUserLanguage] = useState('en')
  const [focusedCorrection, setFocusedCorrection] = useState<{
    source: 'chat' | 'ai' | 'temporary'
    originalText: string
    analysis: Correction
  } | null>(null)

  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const maxInputHeight = 120

  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useParams()
  const featureParam = params?.feature
  const featureValue = Array.isArray(featureParam) ? featureParam[0] : featureParam
  const isValidFeature = FEATURE_KEYS.includes(featureValue as FeatureKey)
  const activeFeature: FeatureKey = isValidFeature ? (featureValue as FeatureKey) : DEFAULT_FEATURE
  const isFocusedCorrectionMode = activeFeature === 'correction' && focusedCorrection !== null

  const supabase = createClient()

  useEffect(() => {
    if (featureValue && !isValidFeature) {
      router.replace(`/play/${DEFAULT_FEATURE}`)
    }
  }, [featureValue, isValidFeature, router])

  useEffect(() => {
    if (activeFeature !== 'correction') {
      setFocusedCorrection(null)
      return
    }

    const shouldFocus = searchParams.get('focus') === '1'
    if (!shouldFocus) {
      setFocusedCorrection(null)
      return
    }

    const payload = loadFocusedCorrection()
    if (!payload) {
      setFocusedCorrection(null)
      setCorrection(null)
      return
    }

    setFocusedCorrection({
      source: payload.source,
      originalText: payload.originalText,
      analysis: payload.analysis,
    })
    setText(payload.originalText)
    setCorrection(payload.analysis)
  }, [activeFeature, searchParams])

  useEffect(() => {
    try {
      const draftText = sessionStorage.getItem(PLAYGROUND_STORAGE_KEY)
      if (draftText) {
        setText(draftText)
        sessionStorage.removeItem(PLAYGROUND_STORAGE_KEY)
      }
    } catch (error) {
      console.error('[Playground] Failed to read session storage draft:', error)
    }
  }, [])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const nextHeight = Math.min(el.scrollHeight, maxInputHeight)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxInputHeight ? 'auto' : 'hidden'
  }, [text, maxInputHeight])

  useEffect(() => {
    async function getUserSettings() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('language_preference, feedback_language')
          .eq('id', user.id)
          .single()
        if (profile?.language_preference) {
          setUserLanguage(profile.language_preference)
          setTargetLanguage(profile.language_preference)
          setFeedbackLanguage(profile.feedback_language || profile.language_preference)
        }
      }
    }

    getUserSettings()

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [supabase])

  async function transcribeAudio(blob: Blob): Promise<string> {
    try {
      return await transcribeAudioWithRetry(blob, {
        language: userLanguage || 'auto',
        source: 'PlayPage',
      })
    } catch (error) {
      console.error('[PlayPage] Transcription error:', error)
      return ''
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

        setIsTranscribing(true)
        try {
          const transcription = await transcribeAudio(blob)
          if (transcription) {
            setText(transcription)
          }
        } catch (error) {
          console.error('[PlayPage] Transcription failed:', error)
          setFeatureError(activeFeature, 'Failed to transcribe audio')
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
      setFeatureError(activeFeature, 'Failed to access microphone. Please check permissions.')
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

  function setFeatureError(feature: FeatureKey, message: string) {
    switch (feature) {
      case 'translate':
        setTranslateError(message)
        break
      case 'alternatives':
        setAlternativesError(message)
        break
      case 'correction':
        setCorrectionError(message)
        break
      case 'scale':
        setScaleError(message)
        break
      default:
        break
    }
  }

  const loadingMap: Record<FeatureKey, boolean> = {
    translate: translateLoading,
    alternatives: alternativesLoading,
    correction: correctionLoading,
    scale: scaleLoading,
  }

  const errorMap: Record<FeatureKey, string> = {
    translate: translateError,
    alternatives: alternativesError,
    correction: correctionError,
    scale: scaleError,
  }

  const currentLoading = loadingMap[activeFeature]
  const currentError = errorMap[activeFeature]

  function refocusInput() {
    requestAnimationFrame(() => {
      if (!isRecording && !isTranscribing) {
        inputRef.current?.focus()
      }
    })
  }

  useEffect(() => {
    if (isFocusedCorrectionMode || isRecording || isTranscribing || currentLoading) {
      return
    }
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [activeFeature, isFocusedCorrectionMode, isRecording, isTranscribing, currentLoading])

  async function handleTranslate() {
    if (!text.trim()) {
      setTranslateError('Please enter text to translate')
      return
    }

    setTranslateLoading(true)
    setTranslateError('')
    setTranslations(null)

    try {
      const data = await postJsonWithRetry<{
        translations: {
          direct: string
          formal: string
          casual: string
        }
      }>(
        '/api/translate-with-alternatives',
        {
          text: text.trim(),
          targetLanguage,
        },
        { source: 'PlayPage.handleTranslate' }
      )
      setTranslations(data.translations)
    } catch (err) {
      console.error('[PlayPage] Translate error:', err)
      setTranslateError(err instanceof Error ? err.message : 'Failed to translate')
    } finally {
      setTranslateLoading(false)
    }
  }

  async function handleAlternatives() {
    if (!text.trim()) {
      setAlternativesError('Please enter a sentence for alternatives')
      return
    }

    setAlternativesLoading(true)
    setAlternativesError('')
    setAlternatives([])

    try {
      const data = await postJsonWithRetry<{
        alternatives: string[]
      }>(
        '/api/alternatives',
        {
          text: text.trim(),
        },
        { source: 'PlayPage.handleAlternatives' }
      )
      setAlternatives(data.alternatives || [])
    } catch (err) {
      console.error('[PlayPage] Alternatives error:', err)
      setAlternativesError(err instanceof Error ? err.message : 'Failed to get alternatives')
    } finally {
      setAlternativesLoading(false)
    }
  }

  async function handleCorrection() {
    if (!text.trim()) {
      setCorrectionError('Please enter a sentence for correction')
      return
    }

    setCorrectionLoading(true)
    setCorrectionError('')
    setCorrection(null)

    try {
      const data = await postJsonWithRetry<{
        analysis: Correction
      }>(
        '/api/correction',
        {
          text: text.trim(),
          feedbackLanguage,
        },
        { source: 'PlayPage.handleCorrection' }
      )
      setCorrection(data.analysis)
    } catch (err) {
      console.error('[PlayPage] Correction error:', err)
      setCorrectionError(err instanceof Error ? err.message : 'Failed to get corrections')
    } finally {
      setCorrectionLoading(false)
    }
  }

  async function handleScale() {
    if (!text.trim()) {
      setScaleError('Please enter text to scale')
      return
    }

    setScaleLoading(true)
    setScaleError('')
    setScaleResult(null)

    try {
      const data = await postJsonWithRetry<ScaleResult>(
        '/api/scale',
        {
          text: text.trim(),
          targetLevel,
          language: userLanguage,
        },
        { source: 'PlayPage.handleScale' }
      )
      setScaleResult(data)
    } catch (err) {
      console.error('[PlayPage] Scale error:', err)
      setScaleError(err instanceof Error ? err.message : 'Failed to scale text')
    } finally {
      setScaleLoading(false)
    }
  }

  async function handleAction() {
    switch (activeFeature) {
      case 'translate':
        await handleTranslate()
        break
      case 'alternatives':
        await handleAlternatives()
        break
      case 'correction':
        await handleCorrection()
        break
      case 'scale':
        await handleScale()
        break
      default:
        break
    }
  }

  async function copyTranslation(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  async function copyAlternative(value: string, index: number) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  async function copyCorrected(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedCorrected(true)
      setTimeout(() => setCopiedCorrected(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  async function copyScaled(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedScaled(true)
      setTimeout(() => setCopiedScaled(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  function getScoreColor(score: number): string {
    if (score >= 90) return 'text-green-600'
    if (score >= 70) return 'text-yellow-600'
    if (score >= 50) return 'text-orange-600'
    return 'text-red-600'
  }

  function getScoreBg(score: number): string {
    if (score >= 90) return 'bg-green-100'
    if (score >= 70) return 'bg-yellow-100'
    if (score >= 50) return 'bg-orange-100'
    return 'bg-red-100'
  }

  function getIssueColor(type: string): string {
    switch (type) {
      case 'grammar':
        return 'border-red-200 bg-red-50'
      case 'spelling':
        return 'border-orange-200 bg-orange-50'
      case 'word_choice':
        return 'border-blue-200 bg-blue-50'
      case 'punctuation':
        return 'border-purple-200 bg-purple-50'
      case 'style':
        return 'border-teal-200 bg-teal-50'
      default:
        return 'border-gray-200 bg-gray-50'
    }
  }

  function exitFocusedCorrectionMode() {
    clearFocusedCorrection()
    setFocusedCorrection(null)
    router.replace('/play/correction')
  }

  return (
    <div className="flex min-h-full flex-col bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="mx-auto flex w-full max-w-5xl flex-1 min-h-0 flex-col px-4 pt-3">
        <div className="mb-3">
          <div className="mb-2">
            <h1 className="text-2xl font-semibold text-gray-900">Playground</h1>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pb-8">
          <div className="space-y-6 pb-4">
          {activeFeature === 'translate' && (
            <div className="space-y-6">
              {translations && (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Translations</h3>
                  <div className="space-y-3">
                    {(Object.keys(TRANSLATION_LABELS) as Array<keyof typeof TRANSLATION_LABELS>).map((key) => (
                      <div
                        key={key}
                        className={`rounded-xl border p-4 transition-all ${key === 'direct'
                            ? 'border-azure bg-azure/5 shadow-sm'
                            : 'border-gray-200 hover:border-azure hover:shadow-sm'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="text-sm font-medium text-gray-700">
                                {TRANSLATION_LABELS[key].label}
                              </span>
                              <span className="text-xs text-gray-500">- {TRANSLATION_LABELS[key].description}</span>
                            </div>
                            <p className="text-gray-800">{translations[key]}</p>
                          </div>
                          <button
                            onClick={() => copyTranslation(translations[key], key)}
                            className="flex-shrink-0 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                            title="Copy to clipboard"
                          >
                            {copiedKey === key ? (
                              <svg className="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeFeature === 'alternatives' && (
            alternatives.length > 0 && (
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
                <div className="space-y-3">
                  {alternatives.map((alt, index) => (
                    <div
                      key={index}
                      className="rounded-xl border border-gray-200 p-4 hover:border-azure hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-gray-700">
                              {ALTERNATIVE_LABELS[index]?.label ?? `Option ${index + 1}`}
                            </span>
                            {ALTERNATIVE_LABELS[index]?.description && (
                              <span className="text-xs text-gray-500">- {ALTERNATIVE_LABELS[index].description}</span>
                            )}
                          </div>
                          <p className="text-gray-800">{alt}</p>
                        </div>
                        <button
                          onClick={() => copyAlternative(alt, index)}
                          className="flex-shrink-0 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                          title="Copy to clipboard"
                        >
                          {copiedIndex === index ? (
                            <svg className="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                              />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {activeFeature === 'correction' && (
            <div className="space-y-6">
              {correction && (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {isFocusedCorrectionMode ? 'Message Correction Explanation' : 'Corrections'}
                    </h3>
                    {isFocusedCorrectionMode && (
                      <button
                        type="button"
                        onClick={exitFocusedCorrectionMode}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        Back to tool
                      </button>
                    )}
                  </div>
                  <div className="space-y-4">
                    <div className={`rounded-xl p-4 ${getScoreBg(correction.overallScore)}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className={`text-3xl font-bold ${getScoreColor(correction.overallScore)}`}>
                            {correction.overallScore}
                          </span>
                          <span className="text-sm text-gray-600">/ 100</span>
                        </div>
                        {correction.issues.length === 0 && (
                          <span className="text-green-600 font-medium">Perfect</span>
                        )}
                      </div>

                      {correction.correctedSentence !== text && (
                        <div className="bg-white rounded-lg p-3 border">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-500 uppercase">Corrected</span>
                            {!isFocusedCorrectionMode && (
                              <button
                                onClick={() => copyCorrected(correction.correctedSentence)}
                                className="text-gray-500 hover:text-gray-700 p-1"
                                title="Copy corrected sentence"
                              >
                                {copiedCorrected ? (
                                  <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    />
                                  </svg>
                                )}
                              </button>
                            )}
                          </div>
                          <p className="text-gray-800">{correction.correctedSentence}</p>
                        </div>
                      )}
                    </div>

                    {correction.issues.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">Issues Found ({correction.issues.length})</h4>
                        <div className="space-y-2">
                          {correction.issues.map((issue, index) => (
                            <div
                              key={index}
                              className={`rounded-lg border p-3 ${getIssueColor(issue.type)}`}
                            >
                              <div className="flex items-start gap-3">
                                <div className="mt-2 h-2 w-2 rounded-full bg-gray-400"></div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="line-through text-red-600 font-medium">{issue.original}</span>
                                    <span className="text-gray-400">-&gt;</span>
                                    <span className="text-green-600 font-medium">{issue.correction}</span>
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-white text-gray-500 capitalize">
                                      {issue.type.replace('_', ' ')}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-600 mt-1">{issue.explanation}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!isFocusedCorrectionMode && correction.wordSuggestions.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">Word Suggestions</h4>
                        <div className="space-y-2">
                          {correction.wordSuggestions.map((suggestion, index) => (
                            <div
                              key={index}
                              className="rounded-lg border border-blue-200 bg-blue-50 p-3"
                            >
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="font-medium text-gray-700">&quot;{suggestion.original}&quot;</span>
                                <span className="text-gray-400">could also be:</span>
                                {suggestion.alternatives.map((alt, i) => (
                                  <span
                                    key={i}
                                    className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-sm font-medium"
                                  >
                                    {alt}
                                  </span>
                                ))}
                              </div>
                              <p className="text-sm text-gray-600">{suggestion.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid md:grid-cols-2 gap-3">
                      {correction.praise && (
                        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-green-800">What you did well</span>
                          </div>
                          <p className="text-sm text-green-700">{correction.praise}</p>
                        </div>
                      )}
                      {correction.tip && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-amber-800">Teacher Tip</span>
                          </div>
                          <p className="text-sm text-amber-700">{correction.tip}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeFeature === 'scale' && (
            <div className="space-y-6">
              {scaleResult && (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                      <span>Original level:</span>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 font-medium capitalize">
                        {scaleResult.originalLevel}
                      </span>
                      {!scaleResult.wasScaled && (
                        <span className="text-green-600 flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Already at target level
                        </span>
                      )}
                    </div>

                    <div className="rounded-xl border border-azure bg-azure/5 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-gray-900">
                          {LEVEL_INFO[targetLevel].label} version
                        </div>
                        <button
                          onClick={() => copyScaled(scaleResult.scaledText)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                          title="Copy to clipboard"
                        >
                          {copiedScaled ? (
                            <svg className="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                              />
                            </svg>
                          )}
                        </button>
                      </div>
                      <p className="text-gray-800 leading-relaxed">{scaleResult.scaledText}</p>
                    </div>

                    {scaleResult.wasScaled && scaleResult.changes.length > 0 && (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <h4 className="font-medium text-gray-900 mb-2">Changes made</h4>
                        <ul className="space-y-1 text-sm text-gray-600 list-disc list-inside">
                          {scaleResult.changes.map((change, index) => (
                            <li key={index}>{change}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      {!isFocusedCorrectionMode && (
        <div>
          <div className="mx-auto max-w-5xl px-4 pt-2 pb-4">
            {(activeFeature === 'translate' || activeFeature === 'correction' || activeFeature === 'scale') && (
              <div className="mb-3 flex justify-center">
                <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  {activeFeature === 'translate' && (
                    <>
                      <label htmlFor="play-translate-language" className="text-sm font-medium text-gray-700">
                        Translate to
                      </label>
                      <select
                        id="play-translate-language"
                        value={targetLanguage}
                        onChange={(e) => {
                          setTargetLanguage(e.target.value)
                          refocusInput()
                        }}
                        className="min-w-[180px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-azure"
                      >
                        {LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {activeFeature === 'correction' && (
                    <>
                      <label htmlFor="play-feedback-language" className="text-sm font-medium text-gray-700">
                        Feedback language
                      </label>
                      <select
                        id="play-feedback-language"
                        value={feedbackLanguage}
                        onChange={(e) => {
                          setFeedbackLanguage(e.target.value)
                          refocusInput()
                        }}
                        className="min-w-[180px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-azure"
                      >
                        {LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {activeFeature === 'scale' && (
                    <>
                      <label htmlFor="play-target-level" className="text-sm font-medium text-gray-700">
                        Target level
                      </label>
                      <select
                        id="play-target-level"
                        value={targetLevel}
                        onChange={(e) => {
                          setTargetLevel(e.target.value as ProficiencyLevel)
                          refocusInput()
                        }}
                        className="min-w-[180px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-azure"
                      >
                        {(Object.keys(LEVEL_INFO) as ProficiencyLevel[]).map((level) => (
                          <option key={level} value={level}>
                            {LEVEL_INFO[level].label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="mb-3 grid gap-2 grid-cols-2 sm:grid-cols-4">
              {FEATURE_OPTIONS.map((feature) => {
                const isActive = feature.key === activeFeature
                return (
                  <button
                    key={feature.key}
                    onClick={() => {
                      if (!isActive) {
                        router.replace(`/play/${feature.key}`)
                      }
                      refocusInput()
                    }}
                    data-testid={`playground-feature-${feature.key}`}
                    className={`rounded-2xl border-2 p-2.5 text-center transition-all ${isActive
                        ? 'border-azure bg-white shadow-sm'
                        : 'border-gray-200 bg-white hover:border-azure/40 hover:shadow-sm'
                      }`}
                    aria-pressed={isActive}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span className={`${isActive ? 'text-azure' : 'text-gray-600'}`}>
                        {feature.icon}
                      </span>
                      <p className="text-sm font-semibold text-gray-900">{feature.label}</p>
                    </div>
                  </button>
                )
              })}
            </div>

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

            {isTranscribing && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-gray-100 p-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-azure border-t-transparent"></div>
                <span className="text-sm text-gray-600">Transcribing...</span>
              </div>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault()
                void handleAction()
              }}
              className="flex items-center justify-center gap-2"
            >
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={currentLoading || isTranscribing}
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
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleAction()
                  }
                }}
                placeholder="hello frende..."
                disabled={currentLoading || isRecording || isTranscribing}
                rows={1}
                ref={inputRef}
                autoFocus
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                data-testid="playground-input"
                className="flex-1 max-w-2xl min-h-12 max-h-[120px] resize-none rounded-full border-2 px-5 py-3 leading-5 focus:outline-none focus:ring-2 focus:ring-azure"
                style={{ borderColor: isInputFocused ? 'var(--azure-blue)' : 'var(--color-gray-400)' }}
              />

              <button
                type="submit"
                disabled={currentLoading || !text.trim() || isRecording || isTranscribing}
                data-testid="playground-action"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-azure text-white hover:bg-azure/90 disabled:bg-gray-400"
              >
                {currentLoading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                )}
              </button>
            </form>

            {currentError && (
              <div className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-600">
                {currentError}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
