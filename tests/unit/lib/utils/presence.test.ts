import { describe, it, expect, vi, afterEach } from 'vitest'
import { getPresenceStatus } from '@/lib/utils/presence'

describe('getPresenceStatus', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks online within 2 minutes', () => {
    vi.useFakeTimers()
    const now = new Date('2026-01-29T12:00:00.000Z')
    vi.setSystemTime(now)

    const lastSeen = new Date(now.getTime() - 60_000).toISOString()
    const result = getPresenceStatus(lastSeen)

    expect(result.isOnline).toBe(true)
    expect(result.lastSeenText).toBe('Online')
  })

  it('shows minutes ago when offline', () => {
    vi.useFakeTimers()
    const now = new Date('2026-01-29T12:00:00.000Z')
    vi.setSystemTime(now)

    const lastSeen = new Date(now.getTime() - 10 * 60_000).toISOString()
    const result = getPresenceStatus(lastSeen)

    expect(result.isOnline).toBe(false)
    expect(result.lastSeenText).toBe('10m ago')
  })

  it('shows hours when older than 60 minutes', () => {
    vi.useFakeTimers()
    const now = new Date('2026-01-29T12:00:00.000Z')
    vi.setSystemTime(now)

    const lastSeen = new Date(now.getTime() - 3 * 60 * 60_000).toISOString()
    const result = getPresenceStatus(lastSeen)

    expect(result.isOnline).toBe(false)
    expect(result.lastSeenText).toBe('3h ago')
  })
})
