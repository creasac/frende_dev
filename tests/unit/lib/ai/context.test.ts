import { describe, it, expect } from 'vitest'
import { pickContextMessages, type AiMessageRow } from '@/lib/ai/context'

function msg(id: string, role: 'user' | 'assistant', content: string, createdAt: string): AiMessageRow {
  return { id, role, content, created_at: createdAt }
}

describe('pickContextMessages', () => {
  it('selects most recent user message by default', () => {
    const messages = [
      msg('1', 'assistant', 'hello', '2026-01-29T10:00:00.000Z'),
      msg('2', 'user', 'first question about apples', '2026-01-29T10:01:00.000Z'),
      msg('3', 'assistant', 'reply', '2026-01-29T10:02:00.000Z'),
      msg('4', 'user', 'second question about oranges', '2026-01-29T10:03:00.000Z'),
    ]

    const result = pickContextMessages(messages, null)
    expect(result.currentMessage?.id).toBe('4')
  })

  it('selects overlapping prior messages when available', () => {
    const messages = [
      msg('1', 'user', 'How do I translate to Spanish?', '2026-01-29T10:00:00.000Z'),
      msg('2', 'assistant', 'reply', '2026-01-29T10:00:30.000Z'),
      msg('3', 'user', 'Translation in French is also needed', '2026-01-29T10:01:00.000Z'),
      msg('4', 'assistant', 'reply', '2026-01-29T10:01:30.000Z'),
      msg('5', 'user', 'Translate this sentence to Spanish', '2026-01-29T10:02:00.000Z'),
    ]

    const result = pickContextMessages(messages, '5')
    const contextIds = result.contextMessages.map((m) => m.id)

    expect(result.currentMessage?.id).toBe('5')
    expect(contextIds).toContain('1')
  })

  it('falls back to recent messages when no overlap', () => {
    const messages = [
      msg('1', 'user', 'cats and dogs', '2026-01-29T10:00:00.000Z'),
      msg('2', 'assistant', 'reply', '2026-01-29T10:00:30.000Z'),
      msg('3', 'user', 'mountain hiking tips', '2026-01-29T10:01:00.000Z'),
      msg('4', 'assistant', 'reply', '2026-01-29T10:01:30.000Z'),
      msg('5', 'user', 'quantum physics basics', '2026-01-29T10:02:00.000Z'),
    ]

    const result = pickContextMessages(messages, '5')
    const contextIds = result.contextMessages.map((m) => m.id)

    expect(result.currentMessage?.id).toBe('5')
    expect(contextIds).toEqual(['1', '3'])
  })
})
