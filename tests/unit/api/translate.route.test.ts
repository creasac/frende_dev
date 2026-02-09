import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetApiRateLimitStoreForTests } from '@/lib/api/abuse-guard'

const geminiMocks = vi.hoisted(() => ({
  isGeminiConfigured: vi.fn(),
  generateGeminiContent: vi.fn(),
}))

vi.mock('@/lib/ai/gemini', () => geminiMocks)

async function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/translate', () => {
  beforeEach(() => {
    resetApiRateLimitStoreForTests()
    geminiMocks.isGeminiConfigured.mockReturnValue(true)
    geminiMocks.generateGeminiContent.mockResolvedValue({
      response: { text: () => 'Hola' },
    })
  })

  it('returns 400 for missing fields', async () => {
    const { POST } = await import('@/app/api/translate/route')
    const req = await jsonRequest({ text: 'hi' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns original text when languages match', async () => {
    const { POST } = await import('@/app/api/translate/route')
    const req = await jsonRequest({ text: 'hello', source_lang: 'en', target_lang: 'en' })
    const res = await POST(req)
    const json = await res.json()
    expect(json.translated_text).toBe('hello')
  })

  it('calls Gemini when translation needed', async () => {
    const { POST } = await import('@/app/api/translate/route')
    const req = await jsonRequest({ text: 'hello', source_lang: 'en', target_lang: 'es' })
    const res = await POST(req)
    const json = await res.json()
    expect(json.translated_text).toBe('Hola')
    expect(geminiMocks.generateGeminiContent).toHaveBeenCalled()
  })

  it('returns 413 for oversized text input', async () => {
    const { POST } = await import('@/app/api/translate/route')
    const req = await jsonRequest({
      text: 'x'.repeat(5001),
      source_lang: 'en',
      target_lang: 'es',
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
  })

  it('returns 429 after repeated requests from same IP', async () => {
    const { POST } = await import('@/app/api/translate/route')
    let status = 200

    for (let i = 0; i < 21; i += 1) {
      const req = new NextRequest('http://localhost/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ text: 'hello', source_lang: 'en', target_lang: 'es' }),
      })
      const res = await POST(req)
      status = res.status
    }

    expect(status).toBe(429)
  })

  it('does not leak internal error details on translation failure', async () => {
    geminiMocks.generateGeminiContent.mockRejectedValue(new Error('upstream failure details'))
    const { POST } = await import('@/app/api/translate/route')
    const req = await jsonRequest({ text: 'hello', source_lang: 'en', target_lang: 'es' })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe('Translation failed')
    expect(json.details).toBeUndefined()
    expect(typeof json.requestId).toBe('string')
    expect(json.requestId.length).toBeGreaterThan(0)
  })
})
