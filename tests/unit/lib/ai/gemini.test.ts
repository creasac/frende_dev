import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const generateContentMock = vi.fn()

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    key: string
    constructor(key: string) {
      this.key = key
    }
    getGenerativeModel() {
      return {
        generateContent: generateContentMock,
      }
    }
  }
  return { GoogleGenerativeAI }
})

async function loadModule() {
  vi.resetModules()
  return await import('@/lib/ai/gemini')
}

describe('gemini client', () => {
  beforeEach(() => {
    generateContentMock.mockReset()
    delete (globalThis as typeof globalThis & { __geminiKeyIndex?: number }).__geminiKeyIndex
    delete process.env.GEMINI_API_KEYS
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY_1
    delete process.env.GEMINI_API_KEY_2
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects configured keys', async () => {
    process.env.GEMINI_API_KEYS = 'key-1,key-2'
    const { isGeminiConfigured } = await loadModule()
    expect(isGeminiConfigured()).toBe(true)
  })

  it('rotates keys on retryable errors', async () => {
    process.env.GEMINI_API_KEYS = 'key-1,key-2'

    generateContentMock
      .mockImplementationOnce(async () => {
        const error = new Error('rate limit') as Error & { status?: number }
        error.status = 429
        throw error
      })
      .mockImplementationOnce(async () => ({
        response: { text: () => 'ok' },
      }))

    const { generateGeminiContent } = await loadModule()
    const result = await generateGeminiContent({ request: 'hello' })
    const text = await result.response.text()

    expect(text).toBe('ok')
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })
})
