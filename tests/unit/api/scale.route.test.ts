import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetApiRateLimitStoreForTests } from '@/lib/api/abuse-guard'

const geminiMocks = vi.hoisted(() => ({
  isGeminiConfigured: vi.fn(),
  generateGeminiContent: vi.fn(),
}))

vi.mock('@/lib/ai/gemini', () => geminiMocks)

async function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/scale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/scale', () => {
  beforeEach(() => {
    resetApiRateLimitStoreForTests()
    geminiMocks.isGeminiConfigured.mockReturnValue(true)
    geminiMocks.generateGeminiContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            scaledText: 'Simple text.',
            originalLevel: 'advanced',
            wasScaled: true,
            changes: ['Simplified vocabulary'],
          }),
      },
    })
  })

  it('returns 400 for invalid target level', async () => {
    const { POST } = await import('@/app/api/scale/route')
    const req = await jsonRequest({ text: 'hello', targetLevel: 'expert' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns scaled result', async () => {
    const { POST } = await import('@/app/api/scale/route')
    const req = await jsonRequest({ text: 'hello', targetLevel: 'beginner' })
    const res = await POST(req)
    const json = await res.json()
    expect(json.scaledText).toBe('Simple text.')
    expect(json.wasScaled).toBe(true)
  })
})
