import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'

async function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/ai-chat', () => {
  it('returns 400 when missing sessionId', async () => {
    const { POST } = await import('@/app/api/ai-chat/route')
    const req = await jsonRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
