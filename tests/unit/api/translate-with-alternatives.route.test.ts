import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetApiRateLimitStoreForTests } from '@/lib/api/abuse-guard'

const geminiMocks = vi.hoisted(() => ({
  isGeminiConfigured: vi.fn(),
  generateGeminiContent: vi.fn(),
}))

vi.mock('@/lib/ai/gemini', () => geminiMocks)

async function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/translate-with-alternatives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/translate-with-alternatives', () => {
  beforeEach(() => {
    resetApiRateLimitStoreForTests()
    geminiMocks.isGeminiConfigured.mockReturnValue(true)
    geminiMocks.generateGeminiContent.mockResolvedValue({
      response: {
        text: () => '{"direct":"Hola","formal":"Saludos","casual":"Qué tal"}',
      },
    })
  })

  it('returns 400 for missing target language', async () => {
    const { POST } = await import('@/app/api/translate-with-alternatives/route')
    const req = await jsonRequest({ text: 'hello' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns translation variants', async () => {
    const { POST } = await import('@/app/api/translate-with-alternatives/route')
    const req = await jsonRequest({ text: 'hello', targetLanguage: 'es' })
    const res = await POST(req)
    const json = await res.json()
    expect(json.translations).toEqual({
      direct: 'Hola',
      formal: 'Saludos',
      casual: 'Qué tal',
    })
  })

  it('returns 413 for oversized target language input', async () => {
    const { POST } = await import('@/app/api/translate-with-alternatives/route')
    const req = await jsonRequest({
      text: 'hello',
      targetLanguage: 'x'.repeat(33),
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
  })
})
