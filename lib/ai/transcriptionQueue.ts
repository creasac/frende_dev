type QueuedTranscription = {
  id: string
  audio: Blob
  language: string
  createdAt: number
  lastAttempt: number
  retryCount: number
  source?: string
  storage?: 'persistent' | 'memory'
}

type TranscriptionOptions = {
  language?: string
  source?: string
  persist?: boolean
}

export type TranscriptionResult = {
  text: string
  language?: string
}

const DB_NAME = 'frende-transcription-queue'
const STORE_NAME = 'transcriptions'
const DB_VERSION = 1

const MAX_TRANSCRIPTION_ATTEMPTS = 4
const RETRY_INTERVAL_MS = 60_000
const RETRY_DELAY_MS = 60_000

type TranscriptionCallback = {
  resolve: (result: TranscriptionResult) => void
  reject: (error: Error) => void
}

const transcriptionCallbacks = new Map<string, TranscriptionCallback>()
const ephemeralQueue = new Map<string, QueuedTranscription>()
const persistentFallbackQueue = new Map<string, QueuedTranscription>()

let dbPromise: Promise<IDBDatabase> | null = null
let useMemoryFallback = typeof window === 'undefined' || !('indexedDB' in window)
let retryIntervalId: ReturnType<typeof setInterval> | null = null
let isProcessing = false
let onlineListenerAttached = false
let isInitialized = false

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function getDb(): Promise<IDBDatabase | null> {
  if (useMemoryFallback) {
    return null
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  try {
    return await dbPromise
  } catch (error) {
    console.error('[TranscriptionQueue] IndexedDB unavailable, falling back to memory:', error)
    useMemoryFallback = true
    dbPromise = null
    return null
  }
}

async function saveQueueItem(item: QueuedTranscription): Promise<void> {
  if (item.storage === 'memory') {
    ephemeralQueue.set(item.id, item)
    return
  }

  const db = await getDb()
  if (!db) {
    persistentFallbackQueue.set(item.id, item)
    return
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      tx.objectStore(STORE_NAME).put(item)
    })
  } catch (error) {
    console.error('[TranscriptionQueue] Failed to persist item, using memory:', error)
    useMemoryFallback = true
    persistentFallbackQueue.set(item.id, item)
  }
}

async function removeQueueItem(id: string): Promise<void> {
  ephemeralQueue.delete(id)
  persistentFallbackQueue.delete(id)

  const db = await getDb()
  if (!db) {
    return
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      tx.objectStore(STORE_NAME).delete(id)
    })
  } catch (error) {
    console.error('[TranscriptionQueue] Failed to remove item from IndexedDB:', error)
  }
}

async function loadQueueItems(): Promise<QueuedTranscription[]> {
  const db = await getDb()
  let persistentItems: QueuedTranscription[] = []

  if (!db) {
    persistentItems = Array.from(persistentFallbackQueue.values())
  } else {
    try {
      persistentItems = await new Promise<QueuedTranscription[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const request = tx.objectStore(STORE_NAME).getAll()
        request.onsuccess = () => resolve(request.result as QueuedTranscription[])
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error('[TranscriptionQueue] Failed to load queue items:', error)
      persistentItems = Array.from(persistentFallbackQueue.values())
    }
  }

  return persistentItems.concat(Array.from(ephemeralQueue.values()))
}

async function getQueueCount(): Promise<number> {
  const db = await getDb()
  let persistentCount = 0

  if (!db) {
    persistentCount = persistentFallbackQueue.size
  } else {
    try {
      persistentCount = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const request = tx.objectStore(STORE_NAME).count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error('[TranscriptionQueue] Failed to count queue items:', error)
      persistentCount = persistentFallbackQueue.size
    }
  }

  return persistentCount + ephemeralQueue.size
}

async function transcribeOnce(audio: Blob, language: string): Promise<TranscriptionResult> {
  const formData = new FormData()
  formData.append('audio', audio)
  formData.append('language', language)

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(errorData.error || 'Transcription failed')
  }

  const data = await response.json().catch(() => null)
  if (!data || typeof data !== 'object') {
    return { text: '' }
  }

  const text = typeof (data as { text?: unknown }).text === 'string'
    ? (data as { text: string }).text
    : ''
  const languageResult = typeof (data as { language?: unknown }).language === 'string'
    ? (data as { language: string }).language
    : undefined

  return { text, language: languageResult }
}

function notifyTranscriptionComplete(id: string, result: TranscriptionResult) {
  const callback = transcriptionCallbacks.get(id)
  if (callback) {
    transcriptionCallbacks.delete(id)
    callback.resolve(result)
  }
}

function notifyTranscriptionFailed(id: string, error: Error) {
  const callback = transcriptionCallbacks.get(id)
  if (callback) {
    transcriptionCallbacks.delete(id)
    callback.reject(error)
  }
}

function handleOnline() {
  void processRetryQueue()
}

async function processRetryQueue(): Promise<void> {
  if (isProcessing) {
    return
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return
  }

  isProcessing = true

  try {
    const items = await loadQueueItems()
    if (items.length === 0) {
      stopRetryProcessor()
      return
    }

    const now = Date.now()

    for (const item of items) {
      if (item.retryCount >= MAX_TRANSCRIPTION_ATTEMPTS) {
        await removeQueueItem(item.id)
        notifyTranscriptionFailed(
          item.id,
          new Error('Transcription failed after maximum retry attempts')
        )
        continue
      }

      if (now - item.lastAttempt < RETRY_DELAY_MS) {
        continue
      }

      console.log('[TranscriptionQueue] Retrying transcription:', item.id, 'attempt:', item.retryCount + 1)

      try {
        const result = await transcribeOnce(item.audio, item.language)
        await removeQueueItem(item.id)
        console.log('[TranscriptionQueue] Transcription succeeded:', item.id)
        notifyTranscriptionComplete(item.id, result)
      } catch (error) {
        console.error('[TranscriptionQueue] Retry failed:', error)
        const nextRetryCount = item.retryCount + 1
        if (nextRetryCount >= MAX_TRANSCRIPTION_ATTEMPTS) {
          await removeQueueItem(item.id)
          notifyTranscriptionFailed(
            item.id,
            new Error('Transcription failed after maximum retry attempts')
          )
          continue
        }

        const updatedItem: QueuedTranscription = {
          ...item,
          retryCount: nextRetryCount,
          lastAttempt: Date.now(),
        }
        await saveQueueItem(updatedItem)
      }
    }
  } catch (error) {
    console.error('[TranscriptionQueue] Queue processing error:', error)
  } finally {
    isProcessing = false
  }

  const remaining = await getQueueCount()
  if (remaining === 0) {
    stopRetryProcessor()
  }
}

function startRetryProcessor() {
  if (!retryIntervalId) {
    console.log('[TranscriptionQueue] Starting retry processor')
    retryIntervalId = setInterval(() => {
      void processRetryQueue()
    }, RETRY_INTERVAL_MS)
  }

  if (typeof window !== 'undefined' && !onlineListenerAttached) {
    window.addEventListener('online', handleOnline)
    onlineListenerAttached = true
  }

  void processRetryQueue()
}

function stopRetryProcessor() {
  if (retryIntervalId) {
    clearInterval(retryIntervalId)
    retryIntervalId = null
  }

  if (typeof window !== 'undefined' && onlineListenerAttached) {
    window.removeEventListener('online', handleOnline)
    onlineListenerAttached = false
  }
}

async function initializeQueue(): Promise<void> {
  if (isInitialized) {
    return
  }
  isInitialized = true
  const count = await getQueueCount()
  if (count > 0) {
    startRetryProcessor()
  }
}

function waitForTranscription(id: string): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    transcriptionCallbacks.set(id, { resolve, reject })
  })
}

export async function transcribeAudioWithRetryDetailed(
  audio: Blob,
  options: TranscriptionOptions = {}
): Promise<TranscriptionResult> {
  const language = options.language ?? 'auto'
  const persist = options.persist ?? false

  if (audio.size === 0) {
    console.warn('[TranscriptionQueue] Skipping empty audio blob')
    return { text: '' }
  }

  try {
    return await transcribeOnce(audio, language)
  } catch (error) {
    console.error('[TranscriptionQueue] Transcription failed, queueing retry:', error)

    const id = createRequestId()
    const now = Date.now()
    const queueItem: QueuedTranscription = {
      id,
      audio,
      language,
      createdAt: now,
      lastAttempt: now,
      retryCount: 1,
      source: options.source,
      storage: persist ? 'persistent' : 'memory',
    }

    const waitPromise = waitForTranscription(id)
    await saveQueueItem(queueItem)
    console.log('[TranscriptionQueue] Added to queue:', id, options.source ? `(${options.source})` : '')
    startRetryProcessor()
    return await waitPromise
  }
}

export async function transcribeAudioWithRetry(
  audio: Blob,
  options: TranscriptionOptions = {}
): Promise<string> {
  const result = await transcribeAudioWithRetryDetailed(audio, options)
  return result.text
}

if (typeof window !== 'undefined') {
  void initializeQueue()
}
