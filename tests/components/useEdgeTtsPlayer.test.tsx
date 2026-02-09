import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import useEdgeTtsPlayer from '@/hooks/useEdgeTtsPlayer'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useEdgeTtsPlayer', () => {
  const originalFetch = global.fetch
  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL

  beforeEach(() => {
    let blobCount = 0
    URL.createObjectURL = vi.fn(() => `blob:mock-${++blobCount}`)
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
    vi.restoreAllMocks()
  })

  it('reuses cached object URL for identical payload', async () => {
    global.fetch = vi.fn(async () => new Response(new Blob(['audio-1']), { status: 200 })) as typeof fetch

    const { result } = renderHook(() => useEdgeTtsPlayer())
    const payload = { text: 'hello', language: 'en', rate: 0 }

    const firstUrl = await result.current.getAudioUrl(payload)
    const secondUrl = await result.current.getAudioUrl(payload)

    expect(firstUrl).toBe(secondUrl)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent in-flight requests for identical payload', async () => {
    const deferred = createDeferred<Response>()
    global.fetch = vi.fn(() => deferred.promise) as typeof fetch

    const { result } = renderHook(() => useEdgeTtsPlayer())
    const payload = { text: 'dedupe me', language: 'en', rate: 0 }

    const pendingA = result.current.getAudioUrl(payload)
    const pendingB = result.current.getAudioUrl(payload)

    expect(global.fetch).toHaveBeenCalledTimes(1)

    deferred.resolve(new Response(new Blob(['audio-2']), { status: 200 }))
    const [urlA, urlB] = await Promise.all([pendingA, pendingB])

    expect(urlA).toBe(urlB)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })
})
