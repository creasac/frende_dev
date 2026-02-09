import { createClient } from '@/lib/supabase/client'
import { AiChatMessage } from '@/types/database'

type AiMessageCacheEntry = {
  messages: AiChatMessage[]
  isComplete: boolean
  cachedAt: number
}

const CACHE_TTL_MS = 10 * 60_000
const aiMessageCache = new Map<string, AiMessageCacheEntry>()
const prefetchInFlight = new Map<string, Promise<void>>()

function mergeMessages(existing: AiChatMessage[], incoming: AiChatMessage[]) {
  const byId = new Map(existing.map((message) => [message.id, message]))
  incoming.forEach((message) => byId.set(message.id, message))
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
}

async function delay(ms: number) {
  if (ms <= 0) return
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function getAiMessageCache(sessionId: string): AiMessageCacheEntry | null {
  const entry = aiMessageCache.get(sessionId)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    aiMessageCache.delete(sessionId)
    return null
  }
  return entry
}

export function setAiMessageCache(
  sessionId: string,
  messages: AiChatMessage[],
  options?: { isComplete?: boolean }
) {
  aiMessageCache.set(sessionId, {
    messages: [...messages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
    isComplete: options?.isComplete ?? true,
    cachedAt: Date.now(),
  })
}

export function clearAiMessageCache(sessionId: string) {
  aiMessageCache.delete(sessionId)
}

export async function prefetchAiSessionMessages({
  sessionId,
  limit = 30,
  prefetchAllMessages = false,
  backgroundBatchSize = 80,
  backgroundPauseMs = 120,
}: {
  sessionId: string
  limit?: number
  prefetchAllMessages?: boolean
  backgroundBatchSize?: number
  backgroundPauseMs?: number
}) {
  const existing = getAiMessageCache(sessionId)
  if (existing && (!prefetchAllMessages || existing.isComplete)) return

  const cacheKey = `${sessionId}:${prefetchAllMessages ? 'all' : 'head'}`
  const inFlight = prefetchInFlight.get(cacheKey)
  if (inFlight) {
    await inFlight
    return
  }

  const prefetchTask = (async () => {
    const supabase = createClient()
    let messages = existing ? [...existing.messages] : []
    let isComplete = existing?.isComplete ?? false
    let oldestCreatedAt = messages[0]?.created_at ?? null

    if (!existing) {
      const { data: latestRows, error } = await supabase
        .from('ai_chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit + 1)

      if (error || !latestRows) return

      const hasMore = latestRows.length > limit
      const latestPage = hasMore ? latestRows.slice(0, limit) : latestRows
      messages = [...latestPage].reverse() as AiChatMessage[]
      oldestCreatedAt = messages[0]?.created_at ?? null
      isComplete = !hasMore

      setAiMessageCache(sessionId, messages, { isComplete })
    }

    if (!prefetchAllMessages || isComplete || !oldestCreatedAt) return

    const pageLimit = Math.max(1, backgroundBatchSize)
    let beforeCursor = oldestCreatedAt
    let hasMore = true

    while (hasMore && beforeCursor) {
      const { data: olderRows, error } = await supabase
        .from('ai_chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .lt('created_at', beforeCursor)
        .order('created_at', { ascending: false })
        .limit(pageLimit + 1)

      if (error || !olderRows) break

      hasMore = olderRows.length > pageLimit
      const olderPage = hasMore ? olderRows.slice(0, pageLimit) : olderRows
      const olderMessages = [...olderPage].reverse() as AiChatMessage[]

      if (olderMessages.length === 0) break

      messages = mergeMessages(messages, olderMessages)
      beforeCursor = olderMessages[0]?.created_at ?? null
      isComplete = !hasMore
      setAiMessageCache(sessionId, messages, { isComplete })

      if (hasMore) {
        await delay(backgroundPauseMs)
      }
    }
  })()

  prefetchInFlight.set(cacheKey, prefetchTask)
  try {
    await prefetchTask
  } finally {
    prefetchInFlight.delete(cacheKey)
  }
}
