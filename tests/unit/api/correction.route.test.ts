import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetApiRateLimitStoreForTests } from '@/lib/api/abuse-guard'

const geminiMocks = vi.hoisted(() => ({
  isGeminiConfigured: vi.fn(),
  generateGeminiContent: vi.fn(),
}))

vi.mock('@/lib/ai/gemini', () => geminiMocks)

async function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/correction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/correction', () => {
  beforeEach(() => {
    resetApiRateLimitStoreForTests()
    geminiMocks.isGeminiConfigured.mockReturnValue(true)
    geminiMocks.generateGeminiContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            correctedSentence: 'Hello world.',
            overallScore: 95,
            issues: [],
            wordSuggestions: [],
            praise: 'Great job!',
            tip: 'Keep it up',
          }),
      },
    })
  })

  it('returns 400 for missing text', async () => {
    const { POST } = await import('@/app/api/correction/route')
    const req = await jsonRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns analysis JSON from Gemini', async () => {
    const { POST } = await import('@/app/api/correction/route')
    const req = await jsonRequest({ text: 'Hello world.' })
    const res = await POST(req)
    const json = await res.json()
    expect(json.analysis.correctedSentence).toBe('Hello world.')
    expect(json.analysis.overallScore).toBe(95)
  })
})
