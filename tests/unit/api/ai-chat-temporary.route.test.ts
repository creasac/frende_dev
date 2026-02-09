import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetApiRateLimitStoreForTests } from '@/lib/api/abuse-guard'

const geminiMocks = vi.hoisted(() => ({
  isGeminiConfigured: vi.fn(),
  generateGeminiContent: vi.fn(),
}))

vi.mock('@/lib/ai/gemini', () => geminiMocks)

async function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai-chat/temporary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/ai-chat/temporary', () => {
  beforeEach(() => {
    resetApiRateLimitStoreForTests()
    geminiMocks.isGeminiConfigured.mockReturnValue(true)
    geminiMocks.generateGeminiContent.mockResolvedValue({
      response: { text: () => 'Hello there' },
    })
  })

  it('returns 400 when no messages', async () => {
    const { POST } = await import('@/app/api/ai-chat/temporary/route')
    const req = await jsonRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns AI content', async () => {
    const { POST } = await import('@/app/api/ai-chat/temporary/route')
    const req = await jsonRequest({
      messages: [{ role: 'user', content: 'Hi' }],
    })
    const res = await POST(req)
    const json = await res.json()
    expect(json.content).toBe('Hello there')
  })

  it('returns 413 for oversized message content', async () => {
    const { POST } = await import('@/app/api/ai-chat/temporary/route')
    const req = await jsonRequest({
      messages: [{ role: 'user', content: 'x'.repeat(4001) }],
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
  })
})
