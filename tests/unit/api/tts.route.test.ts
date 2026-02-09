import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { Readable } from 'node:stream'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  MsEdgeTTS: vi.fn(),
  setMetadata: vi.fn(),
  toStream: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

vi.mock('msedge-tts', () => ({
  MsEdgeTTS: mocks.MsEdgeTTS,
  OUTPUT_FORMAT: {
    AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3',
  },
}))

async function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('POST /api/tts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
      },
    })

    mocks.getUser.mockResolvedValue({
      data: {
        user: { id: 'user-1' },
      },
    })

    mocks.MsEdgeTTS.mockImplementation(() => ({
      setMetadata: mocks.setMetadata,
      toStream: mocks.toStream,
      close: mocks.close,
    }))

    mocks.setMetadata.mockResolvedValue(undefined)
    mocks.toStream.mockReturnValue({
      audioStream: Readable.from(Buffer.from('audio-data')),
      metadataStream: null,
    })
  })

  it('returns 401 when user is not authenticated', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: null,
      },
    })

    const { POST } = await import('@/app/api/tts/route')
    const req = await jsonRequest({ text: 'Hello' })
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(mocks.MsEdgeTTS).not.toHaveBeenCalled()
  })

  it('returns 400 when text is missing', async () => {
    const { POST } = await import('@/app/api/tts/route')
    const req = await jsonRequest({ text: '   ' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(mocks.MsEdgeTTS).not.toHaveBeenCalled()
  })

  it('returns audio stream and applies language voice mapping', async () => {
    const { POST } = await import('@/app/api/tts/route')
    const req = await jsonRequest({
      text: 'Hola mundo',
      language: 'es',
      rate: 30,
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('X-TTS-Cache')).toBe('MISS')
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(mocks.setMetadata).toHaveBeenCalledWith(
      'es-ES-ElviraNeural',
      'audio-24khz-48kbitrate-mono-mp3'
    )
    expect(mocks.toStream).toHaveBeenCalledWith('Hola mundo', { rate: '+30%' })

    const audioBuffer = await res.arrayBuffer()
    expect(audioBuffer.byteLength).toBeGreaterThan(0)
  })

  it('returns cached audio on repeated requests with same text settings', async () => {
    const { POST } = await import('@/app/api/tts/route')
    const req = await jsonRequest({
      text: 'Cache this response',
      language: 'en',
      rate: 0,
    })

    const first = await POST(req)
    expect(first.status).toBe(200)
    expect(first.headers.get('X-TTS-Cache')).toBe('MISS')
    expect(mocks.MsEdgeTTS).toHaveBeenCalledTimes(1)

    const secondReq = await jsonRequest({
      text: 'Cache this response',
      language: 'en',
      rate: 0,
    })
    const second = await POST(secondReq)

    expect(second.status).toBe(200)
    expect(second.headers.get('X-TTS-Cache')).toBe('HIT')
    expect(mocks.MsEdgeTTS).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent synthesis for identical requests', async () => {
    const deferred = createDeferred<void>()
    mocks.setMetadata.mockImplementation(() => deferred.promise)

    const { POST } = await import('@/app/api/tts/route')
    const body = {
      text: 'Concurrent dedupe payload',
      language: 'en',
      rate: 0,
    }

    const reqA = await jsonRequest(body)
    const reqB = await jsonRequest(body)

    const pendingA = POST(reqA)
    const pendingB = POST(reqB)

    await vi.waitFor(() => {
      expect(mocks.MsEdgeTTS).toHaveBeenCalledTimes(1)
    })

    deferred.resolve()

    const [resA, resB] = await Promise.all([pendingA, pendingB])
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)
    expect(mocks.MsEdgeTTS).toHaveBeenCalledTimes(1)

    const cacheHeaders = [resA.headers.get('X-TTS-Cache'), resB.headers.get('X-TTS-Cache')]
    expect(cacheHeaders).toContain('MISS')
    expect(cacheHeaders).toContain('HIT')
  })
})
