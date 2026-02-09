import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetApiRateLimitStoreForTests } from '@/lib/api/abuse-guard'

const geminiMocks = vi.hoisted(() => ({
  isGeminiConfigured: vi.fn(),
  generateGeminiContent: vi.fn(),
}))

vi.mock('@/lib/ai/gemini', () => geminiMocks)

describe('POST /api/transcribe', () => {
  beforeEach(() => {
    resetApiRateLimitStoreForTests()
    geminiMocks.isGeminiConfigured.mockReturnValue(true)
    geminiMocks.generateGeminiContent.mockResolvedValue({
      response: { text: () => '{"text":"hello","language":"en"}' },
    })
  })

  it('returns 400 when audio is missing', async () => {
    const { POST } = await import('@/app/api/transcribe/route')
    const formData = new FormData()
    const req = new NextRequest('http://localhost/api/transcribe', {
      method: 'POST',
      body: formData,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns transcription and language', async () => {
    const { POST } = await import('@/app/api/transcribe/route')
    const formData = new FormData()
    formData.append('audio', new Blob(['test'], { type: 'audio/webm' }), 'audio.webm')
    const req = new NextRequest('http://localhost/api/transcribe', {
      method: 'POST',
      body: formData,
    })
    const res = await POST(req)
    const json = await res.json()
    expect(json.text).toBe('hello')
    expect(json.language).toBe('en')
  })

  it('returns 413 for oversized audio uploads', async () => {
    const { POST } = await import('@/app/api/transcribe/route')
    const formData = new FormData()
    formData.append(
      'audio',
      new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'audio/webm' }),
      'audio.webm'
    )
    const req = new NextRequest('http://localhost/api/transcribe', {
      method: 'POST',
      body: formData,
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
  })

  it('does not leak internal error details on transcription failure', async () => {
    geminiMocks.generateGeminiContent.mockRejectedValue(new Error('internal model error details'))
    const { POST } = await import('@/app/api/transcribe/route')
    const formData = new FormData()
    formData.append('audio', new Blob(['test'], { type: 'audio/webm' }), 'audio.webm')
    const req = new NextRequest('http://localhost/api/transcribe', {
      method: 'POST',
      body: formData,
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe('Transcription failed')
    expect(json.details).toBeUndefined()
    expect(typeof json.requestId).toBe('string')
    expect(json.requestId.length).toBeGreaterThan(0)
  })
})
