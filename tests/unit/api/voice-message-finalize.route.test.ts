import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { Readable } from 'node:stream'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
  isGeminiConfigured: vi.fn(),
  generateGeminiContent: vi.fn(),
  MsEdgeTTS: vi.fn(),
  setMetadata: vi.fn(),
  toStream: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

vi.mock('@/lib/ai/gemini', () => ({
  isGeminiConfigured: mocks.isGeminiConfigured,
  generateGeminiContent: mocks.generateGeminiContent,
}))

vi.mock('msedge-tts', () => ({
  MsEdgeTTS: mocks.MsEdgeTTS,
  OUTPUT_FORMAT: {
    AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3',
  },
}))

async function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/voice-message/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/voice-message/finalize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isGeminiConfigured.mockReturnValue(true)

    mocks.MsEdgeTTS.mockImplementation(() => ({
      setMetadata: mocks.setMetadata,
      toStream: mocks.toStream,
      close: mocks.close,
    }))
    mocks.setMetadata.mockResolvedValue(undefined)
    mocks.toStream.mockReturnValue({
      audioStream: Readable.from(Buffer.from('final-mp3')),
      metadataStream: null,
    })
  })

  it('returns 401 when user is not authenticated', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    })

    const { POST } = await import('@/app/api/voice-message/finalize/route')
    const req = await jsonRequest({ messageId: 'msg-1' })
    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  it('finalizes and persists per-user voice rendering', async () => {
    const messageRow = {
      id: 'msg-1',
      sender_id: 'user-1',
      conversation_id: 'conv-1',
      audio_path: 'user-1/conv-1/original.webm',
    }

    const messagesSelectSingle = vi.fn().mockResolvedValue({ data: messageRow, error: null })
    const messagesUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const messagesUpdate = vi.fn(() => ({ eq: messagesUpdateEq }))

    const voiceRenderingsInsert = vi.fn().mockResolvedValue({ error: null })
    const voiceRenderingsUpdateEqUser = vi.fn().mockResolvedValue({ error: null })
    const voiceRenderingsUpdateEqMessage = vi.fn(() => ({ eq: voiceRenderingsUpdateEqUser }))
    const voiceRenderingsUpdate = vi.fn(() => ({ eq: voiceRenderingsUpdateEqMessage }))

    mocks.from.mockImplementation((table: string) => {
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              single: messagesSelectSingle,
            }),
          }),
          update: messagesUpdate,
        }
      }

      if (table === 'message_voice_renderings') {
        return {
          insert: voiceRenderingsInsert,
          update: voiceRenderingsUpdate,
        }
      }

      throw new Error(`Unexpected table mock: ${table}`)
    })

    const storageDownload = vi.fn().mockResolvedValue({
      data: new Blob(['original-audio'], { type: 'audio/webm' }),
      error: null,
    })
    const storageUpload = vi.fn().mockResolvedValue({ error: null })

    mocks.storageFrom.mockReturnValue({
      download: storageDownload,
      upload: storageUpload,
    })

    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: 'user-1',
          language_preference: 'en',
          language_proficiency: null,
          tts_voice: null,
          tts_rate: 0,
        },
        {
          id: 'user-2',
          language_preference: 'en',
          language_proficiency: null,
          tts_voice: null,
          tts_rate: 0,
        },
      ],
      error: null,
    })

    mocks.generateGeminiContent.mockResolvedValue({
      response: Promise.resolve({
        text: () => '{"text":"hello world","language":"en"}',
      }),
    })

    mocks.getUser.mockResolvedValue({
      data: {
        user: { id: 'user-1' },
      },
    })

    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
      },
      from: mocks.from,
      rpc: mocks.rpc,
      storage: {
        from: mocks.storageFrom,
      },
    })

    const { POST } = await import('@/app/api/voice-message/finalize/route')
    const req = await jsonRequest({ messageId: 'msg-1' })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('get_conversation_participant_preferences_secure', {
      conv_id: 'conv-1',
    })
    expect(storageDownload).toHaveBeenCalledWith('user-1/conv-1/original.webm')
    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringContaining('user-1/msg-1/tts-user-2-'),
      expect.any(Blob),
      expect.objectContaining({ contentType: 'audio/mpeg', upsert: true })
    )
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(voiceRenderingsInsert).toHaveBeenCalledTimes(1)
    expect(voiceRenderingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'msg-1',
        user_id: 'user-2',
      })
    )
    expect(voiceRenderingsUpdate).not.toHaveBeenCalled()
    expect(messagesUpdate).toHaveBeenCalled()
  })

  it('updates existing rendering when insert hits unique conflict', async () => {
    const messageRow = {
      id: 'msg-1',
      sender_id: 'user-1',
      conversation_id: 'conv-1',
      audio_path: 'user-1/conv-1/original.webm',
    }

    const messagesSelectSingle = vi.fn().mockResolvedValue({ data: messageRow, error: null })
    const messagesUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const messagesUpdate = vi.fn(() => ({ eq: messagesUpdateEq }))

    const voiceRenderingsInsert = vi.fn().mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })
    const voiceRenderingsUpdateEqUser = vi.fn().mockResolvedValue({ error: null })
    const voiceRenderingsUpdateEqMessage = vi.fn(() => ({ eq: voiceRenderingsUpdateEqUser }))
    const voiceRenderingsUpdate = vi.fn(() => ({ eq: voiceRenderingsUpdateEqMessage }))

    mocks.from.mockImplementation((table: string) => {
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              single: messagesSelectSingle,
            }),
          }),
          update: messagesUpdate,
        }
      }

      if (table === 'message_voice_renderings') {
        return {
          insert: voiceRenderingsInsert,
          update: voiceRenderingsUpdate,
        }
      }

      throw new Error(`Unexpected table mock: ${table}`)
    })

    const storageDownload = vi.fn().mockResolvedValue({
      data: new Blob(['original-audio'], { type: 'audio/webm' }),
      error: null,
    })
    const storageUpload = vi.fn().mockResolvedValue({ error: null })

    mocks.storageFrom.mockReturnValue({
      download: storageDownload,
      upload: storageUpload,
    })

    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: 'user-1',
          language_preference: 'en',
          language_proficiency: null,
          tts_voice: null,
          tts_rate: 0,
        },
        {
          id: 'user-2',
          language_preference: 'en',
          language_proficiency: null,
          tts_voice: null,
          tts_rate: 0,
        },
      ],
      error: null,
    })

    mocks.generateGeminiContent.mockResolvedValue({
      response: Promise.resolve({
        text: () => '{"text":"hello world","language":"en"}',
      }),
    })

    mocks.getUser.mockResolvedValue({
      data: {
        user: { id: 'user-1' },
      },
    })

    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
      },
      from: mocks.from,
      rpc: mocks.rpc,
      storage: {
        from: mocks.storageFrom,
      },
    })

    const { POST } = await import('@/app/api/voice-message/finalize/route')
    const req = await jsonRequest({ messageId: 'msg-1' })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(voiceRenderingsInsert).toHaveBeenCalledTimes(1)
    expect(voiceRenderingsUpdate).toHaveBeenCalledTimes(1)
    expect(voiceRenderingsUpdateEqMessage).toHaveBeenCalledWith('message_id', 'msg-1')
    expect(voiceRenderingsUpdateEqUser).toHaveBeenCalledWith('user_id', 'user-2')
  })

  it('keeps message ready and persists transcript fallback when recipient audio rendering fails', async () => {
    const messageRow = {
      id: 'msg-1',
      sender_id: 'user-1',
      conversation_id: 'conv-1',
      audio_path: 'user-1/conv-1/original.webm',
    }

    const messagesSelectSingle = vi.fn().mockResolvedValue({ data: messageRow, error: null })
    const messagesUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const messagesUpdate = vi.fn(() => ({ eq: messagesUpdateEq }))

    const voiceRenderingsInsert = vi.fn().mockResolvedValue({ error: null })
    const voiceRenderingsUpdateEqUser = vi.fn().mockResolvedValue({ error: null })
    const voiceRenderingsUpdateEqMessage = vi.fn(() => ({ eq: voiceRenderingsUpdateEqUser }))
    const voiceRenderingsUpdate = vi.fn(() => ({ eq: voiceRenderingsUpdateEqMessage }))

    mocks.from.mockImplementation((table: string) => {
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              single: messagesSelectSingle,
            }),
          }),
          update: messagesUpdate,
        }
      }

      if (table === 'message_voice_renderings') {
        return {
          insert: voiceRenderingsInsert,
          update: voiceRenderingsUpdate,
        }
      }

      throw new Error(`Unexpected table mock: ${table}`)
    })

    const storageDownload = vi.fn().mockResolvedValue({
      data: new Blob(['original-audio'], { type: 'audio/webm' }),
      error: null,
    })
    const storageUpload = vi.fn().mockResolvedValue({ error: null })

    mocks.storageFrom.mockReturnValue({
      download: storageDownload,
      upload: storageUpload,
    })

    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: 'user-1',
          language_preference: 'en',
          language_proficiency: null,
          tts_voice: null,
          tts_rate: 0,
        },
        {
          id: 'user-2',
          language_preference: 'en',
          language_proficiency: null,
          tts_voice: null,
          tts_rate: 0,
        },
      ],
      error: null,
    })

    mocks.generateGeminiContent.mockResolvedValue({
      response: Promise.resolve({
        text: () => '{"text":"hello world","language":"en"}',
      }),
    })
    mocks.setMetadata.mockRejectedValueOnce(new Error('tts unavailable'))

    mocks.getUser.mockResolvedValue({
      data: {
        user: { id: 'user-1' },
      },
    })

    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
      },
      from: mocks.from,
      rpc: mocks.rpc,
      storage: {
        from: mocks.storageFrom,
      },
    })

    const { POST } = await import('@/app/api/voice-message/finalize/route')
    const req = await jsonRequest({ messageId: 'msg-1' })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.warnings).toBeGreaterThan(0)
    expect(voiceRenderingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'msg-1',
        user_id: 'user-2',
        final_text: 'hello world',
        final_audio_path: 'user-1/conv-1/original.webm',
        processing_status: 'failed',
        error_message: expect.stringContaining('Audio rendering unavailable'),
      })
    )
    expect(messagesUpdate).toHaveBeenCalledWith(expect.objectContaining({ processing_status: 'ready' }))
  })

  it('bypasses recipient personalization and skips Gemini for as-is voice messages', async () => {
    const messageRow = {
      id: 'msg-1',
      sender_id: 'user-1',
      conversation_id: 'conv-1',
      audio_path: 'user-1/conv-1/original.webm',
      bypass_recipient_preferences: true,
    }

    const messagesSelectSingle = vi.fn().mockResolvedValue({ data: messageRow, error: null })
    const messagesUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const messagesUpdate = vi.fn(() => ({ eq: messagesUpdateEq }))

    const voiceRenderingsInsert = vi.fn().mockResolvedValue({ error: null })
    const voiceRenderingsUpdateEqUser = vi.fn().mockResolvedValue({ error: null })
    const voiceRenderingsUpdateEqMessage = vi.fn(() => ({ eq: voiceRenderingsUpdateEqUser }))
    const voiceRenderingsUpdate = vi.fn(() => ({ eq: voiceRenderingsUpdateEqMessage }))

    mocks.from.mockImplementation((table: string) => {
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              single: messagesSelectSingle,
            }),
          }),
          update: messagesUpdate,
        }
      }

      if (table === 'message_voice_renderings') {
        return {
          insert: voiceRenderingsInsert,
          update: voiceRenderingsUpdate,
        }
      }

      throw new Error(`Unexpected table mock: ${table}`)
    })

    const storageDownload = vi.fn()
    const storageUpload = vi.fn()
    mocks.storageFrom.mockReturnValue({
      download: storageDownload,
      upload: storageUpload,
    })

    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: 'user-1',
          language_preference: 'en',
          language_proficiency: null,
          tts_voice: null,
          tts_rate: 0,
        },
      ],
      error: null,
    })

    mocks.getUser.mockResolvedValue({
      data: {
        user: { id: 'user-1' },
      },
    })

    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
      },
      from: mocks.from,
      rpc: mocks.rpc,
      storage: {
        from: mocks.storageFrom,
      },
    })

    const { POST } = await import('@/app/api/voice-message/finalize/route')
    const req = await jsonRequest({ messageId: 'msg-1' })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(storageDownload).not.toHaveBeenCalled()
    expect(storageUpload).not.toHaveBeenCalled()
    expect(mocks.generateGeminiContent).not.toHaveBeenCalled()
    expect(voiceRenderingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'msg-1',
        user_id: 'user-1',
        needs_translation: false,
        needs_scaling: false,
        transcript_text: '',
        final_text: '',
        final_audio_path: 'user-1/conv-1/original.webm',
        final_language: 'und',
      })
    )
    expect(messagesUpdate).toHaveBeenCalledWith({ processing_status: 'ready' })
  })
})
