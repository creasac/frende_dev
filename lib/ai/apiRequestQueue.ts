type QueuedApiRequest = {
  id: string
  url: string
  body: string
  headers: Record<string, string>
  createdAt: number
  lastAttempt: number
  retryCount: number
  source?: string
  storage?: 'persistent' | 'memory'
}

type JsonRequestOptions = {
  headers?: Record<string, string>
  source?: string
  persist?: boolean
}

type RequestCallback = {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
}

type RequestError = Error & {
  status?: number
  retryable?: boolean
}

const DB_NAME = 'frende-api-request-queue'
const STORE_NAME = 'requests'
const DB_VERSION = 1

const MAX_REQUEST_ATTEMPTS = 4
const RETRY_INTERVAL_MS = 60_000
const RETRY_DELAY_MS = 60_000

const requestCallbacks = new Map<string, RequestCallback>()
const ephemeralQueue = new Map<string, QueuedApiRequest>()
const persistentFallbackQueue = new Map<string, QueuedApiRequest>()

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

function createRequestError(message: string, status?: number, retryable?: boolean): RequestError {
  const error = new Error(message) as RequestError
  if (status !== undefined) {
    error.status = status
  }
  if (retryable !== undefined) {
    error.retryable = retryable
  }
  return error
}

function isRetryableStatus(status?: number): boolean {
  if (status === undefined) {
    return true
  }
  if (status >= 500) {
    return true
  }
  return status === 408 || status === 425 || status === 429
}

function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return true
  }

  const candidate = error as RequestError
  if (candidate.retryable !== undefined) {
    return candidate.retryable
  }

  return isRetryableStatus(candidate.status)
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
    console.error('[ApiRequestQueue] IndexedDB unavailable, falling back to memory:', error)
    useMemoryFallback = true
    dbPromise = null
    return null
  }
}

async function saveQueueItem(item: QueuedApiRequest): Promise<void> {
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
    console.error('[ApiRequestQueue] Failed to persist item, using memory:', error)
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
    console.error('[ApiRequestQueue] Failed to remove item from IndexedDB:', error)
  }
}

async function loadQueueItems(): Promise<QueuedApiRequest[]> {
  const db = await getDb()
  let persistentItems: QueuedApiRequest[] = []

  if (!db) {
    persistentItems = Array.from(persistentFallbackQueue.values())
  } else {
    try {
      persistentItems = await new Promise<QueuedApiRequest[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const request = tx.objectStore(STORE_NAME).getAll()
        request.onsuccess = () => resolve(request.result as QueuedApiRequest[])
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error('[ApiRequestQueue] Failed to load queue items:', error)
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
      console.error('[ApiRequestQueue] Failed to count queue items:', error)
      persistentCount = persistentFallbackQueue.size
    }
  }

  return persistentCount + ephemeralQueue.size
}

async function postJsonOnce<T>(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    const message = errorData.error || errorData.message || response.statusText
    throw createRequestError(message, response.status, isRetryableStatus(response.status))
  }

  try {
    return (await response.json()) as T
  } catch {
    throw createRequestError('Invalid JSON response', response.status, false)
  }
}

function notifyRequestComplete(id: string, data: unknown) {
  const callback = requestCallbacks.get(id)
  if (callback) {
    requestCallbacks.delete(id)
    callback.resolve(data)
  }
}

function notifyRequestFailed(id: string, error: Error) {
  const callback = requestCallbacks.get(id)
  if (callback) {
    requestCallbacks.delete(id)
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
      if (item.retryCount >= MAX_REQUEST_ATTEMPTS) {
        await removeQueueItem(item.id)
        notifyRequestFailed(
          item.id,
          createRequestError('Request failed after maximum retry attempts', undefined, false)
        )
        continue
      }

      if (now - item.lastAttempt < RETRY_DELAY_MS) {
        continue
      }

      console.log('[ApiRequestQueue] Retrying request:', item.id, 'attempt:', item.retryCount + 1)

      try {
        const data = await postJsonOnce<unknown>(item.url, item.body, item.headers)
        await removeQueueItem(item.id)
        console.log('[ApiRequestQueue] Request succeeded:', item.id)
        notifyRequestComplete(item.id, data)
      } catch (error) {
        const retryable = isRetryableError(error)
        if (!retryable) {
          console.error('[ApiRequestQueue] Non-retryable error, dropping:', error)
          await removeQueueItem(item.id)
          notifyRequestFailed(item.id, error instanceof Error ? error : new Error('Request failed'))
          continue
        }

        console.error('[ApiRequestQueue] Retry failed:', error)
        const nextRetryCount = item.retryCount + 1
        if (nextRetryCount >= MAX_REQUEST_ATTEMPTS) {
          await removeQueueItem(item.id)
          notifyRequestFailed(
            item.id,
            createRequestError('Request failed after maximum retry attempts', undefined, false)
          )
          continue
        }

        const updatedItem: QueuedApiRequest = {
          ...item,
          retryCount: nextRetryCount,
          lastAttempt: Date.now(),
        }
        await saveQueueItem(updatedItem)
      }
    }
  } catch (error) {
    console.error('[ApiRequestQueue] Queue processing error:', error)
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
    console.log('[ApiRequestQueue] Starting retry processor')
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

function waitForResponse(id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    requestCallbacks.set(id, { resolve, reject })
  })
}

export async function postJsonWithRetry<T>(
  url: string,
  body: unknown,
  options: JsonRequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  const persist = options.persist ?? false

  const bodyJson = JSON.stringify(body)

  if (typeof window === 'undefined') {
    return await postJsonOnce<T>(url, bodyJson, headers)
  }

  try {
    return await postJsonOnce<T>(url, bodyJson, headers)
  } catch (error) {
    if (!isRetryableError(error)) {
      throw error
    }

    console.error('[ApiRequestQueue] Request failed, queueing retry:', error)

    const id = createRequestId()
    const now = Date.now()
    const queueItem: QueuedApiRequest = {
      id,
      url,
      body: bodyJson,
      headers,
      createdAt: now,
      lastAttempt: now,
      retryCount: 1,
      source: options.source,
      storage: persist ? 'persistent' : 'memory',
    }

    const waitPromise = waitForResponse(id)
    await saveQueueItem(queueItem)
    console.log('[ApiRequestQueue] Added to queue:', id, options.source ? `(${options.source})` : '')
    startRetryProcessor()
    return (await waitPromise) as T
  }
}

if (typeof window !== 'undefined') {
  void initializeQueue()
}
