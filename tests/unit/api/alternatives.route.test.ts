import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { resetApiRateLimitStoreForTests } from '@/lib/api/abuse-guard'

const geminiMocks = vi.hoisted(() => ({
  isGeminiConfigured: vi.fn(),
  generateGeminiContent: vi.fn(),
}))

vi.mock('@/lib/ai/gemini', () => geminiMocks)

async function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/alternatives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/alternatives', () => {
  beforeEach(() => {
    resetApiRateLimitStoreForTests()
    geminiMocks.isGeminiConfigured.mockReturnValue(true)
    geminiMocks.generateGeminiContent.mockResolvedValue({
      response: { text: () => '["Alt 1","Alt 2","Alt 3"]' },
    })
  })

  it('returns 400 for missing text', async () => {
    const { POST } = await import('@/app/api/alternatives/route')
    const req = await jsonRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 when Gemini not configured', async () => {
    geminiMocks.isGeminiConfigured.mockReturnValue(false)
    const { POST } = await import('@/app/api/alternatives/route')
    const req = await jsonRequest({ text: 'hello' })
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  it('returns alternatives from Gemini', async () => {
    const { POST } = await import('@/app/api/alternatives/route')
    const req = await jsonRequest({ text: 'hello' })
    const res = await POST(req)
    const json = await res.json()
    expect(json.alternatives).toEqual(['Alt 1', 'Alt 2', 'Alt 3'])
  })
})
