import { createClient } from '@/lib/supabase/client'
import { getClearedAtForUser } from '@/lib/chat/conversations'
import { Message } from '@/types/database'

type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced'

type MessageCacheEntry = {
  messages: Message[]
  translations: Record<string, string>
  scaledTexts: Record<string, string>
  oldestCreatedAt: string | null
  hasMore: boolean
  clearedAt: string | null
  cachedAt: number
}

const CACHE_TTL_MS = 10 * 60_000
const ENHANCEMENT_BATCH_SIZE = 200
const messageCache = new Map<string, MessageCacheEntry>()
const prefetchInFlight = new Map<string, Promise<void>>()

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  if (items.length === 0) return []
  const size = Math.max(1, batchSize)
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

function mergeMessages(existing: Message[], incoming: Message[]) {
  const byId = new Map(existing.map((message) => [message.id, message]))
  incoming.forEach((message) => byId.set(message.id, message))
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
}

async function fetchEnhancementsForMessageIds({
  messageIds,
  userLanguage,
  userProficiency,
}: {
  messageIds: string[]
  userLanguage: string
  userProficiency?: ProficiencyLevel | null
}) {
  if (messageIds.length === 0) {
    return {
      translations: {} as Record<string, string>,
      scaledTexts: {} as Record<string, string>,
    }
  }

  const supabase = createClient()
  const idBatches = splitIntoBatches(messageIds, ENHANCEMENT_BATCH_SIZE)
  const translations: Record<string, string> = {}
  const scaledTexts: Record<string, string> = {}

  for (const batch of idBatches) {
    const { data: translationRows } = await supabase
      .from('message_translations')
      .select('message_id, translated_text')
      .eq('target_language', userLanguage)
      .in('message_id', batch)

    if (translationRows) {
      translationRows.forEach((row) => {
        translations[row.message_id] = row.translated_text
      })
    }

    if (userProficiency) {
      const { data: scaledRows } = await supabase
        .from('message_scaled_texts')
        .select('message_id, scaled_text')
        .eq('target_language', userLanguage)
        .eq('target_proficiency', userProficiency)
        .in('message_id', batch)

      if (scaledRows) {
        scaledRows.forEach((row) => {
          scaledTexts[row.message_id] = row.scaled_text
        })
      }
    }
  }

  return { translations, scaledTexts }
}

async function delay(ms: number) {
  if (ms <= 0) return
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function getMessageCache(conversationId: string, clearedAt: string | null): MessageCacheEntry | null {
  const entry = messageCache.get(conversationId)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    messageCache.delete(conversationId)
    return null
  }
  if (entry.clearedAt !== clearedAt) return null
  return entry
}

export function setMessageCache(conversationId: string, entry: MessageCacheEntry) {
  messageCache.set(conversationId, entry)
}

export function clearMessageCache(conversationId: string) {
  messageCache.delete(conversationId)
}

export async function prefetchConversationMessages({
  conversationId,
  userId,
  userLanguage,
  userProficiency,
  limit = 15,
  prefetchAllMessages = false,
  backgroundBatchSize = 50,
  backgroundPauseMs = 120,
}: {
  conversationId: string
  userId: string
  userLanguage: string
  userProficiency?: ProficiencyLevel | null
  limit?: number
  prefetchAllMessages?: boolean
  backgroundBatchSize?: number
  backgroundPauseMs?: number
}) {
  const clearedAt = await getClearedAtForUser(conversationId, userId)

  const existing = getMessageCache(conversationId, clearedAt)
  if (existing && (!prefetchAllMessages || !existing.hasMore)) return

  const cacheKey = [
    conversationId,
    userId,
    userLanguage,
    userProficiency || 'none',
    clearedAt || 'none',
    prefetchAllMessages ? 'all' : 'head',
  ].join(':')

  const inFlight = prefetchInFlight.get(cacheKey)
  if (inFlight) {
    await inFlight
    return
  }

  const prefetchTask = (async () => {
    const supabase = createClient()
    let messages = existing ? [...existing.messages] : []
    let translations = existing ? { ...existing.translations } : {}
    let scaledTexts = existing ? { ...existing.scaledTexts } : {}
    let hasMore = existing?.hasMore ?? false
    let oldestCreatedAt = existing?.oldestCreatedAt ?? null

    if (!existing) {
      let latestQuery = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit + 1)

      if (clearedAt) {
        latestQuery = latestQuery.gt('created_at', clearedAt)
      }

      const { data: latestRows, error } = await latestQuery
      if (error || !latestRows) return

      hasMore = latestRows.length > limit
      const latestPage = hasMore ? latestRows.slice(0, limit) : latestRows
      messages = [...latestPage].reverse()
      oldestCreatedAt = messages[0]?.created_at ?? null

      const messageIds = messages.map((message) => message.id)
      const enhancements = await fetchEnhancementsForMessageIds({
        messageIds,
        userLanguage,
        userProficiency,
      })
      translations = enhancements.translations
      scaledTexts = enhancements.scaledTexts

      setMessageCache(conversationId, {
        messages,
        translations,
        scaledTexts,
        oldestCreatedAt,
        hasMore,
        clearedAt,
        cachedAt: Date.now(),
      })
    }

    if (!prefetchAllMessages || !hasMore || !oldestCreatedAt) return

    const pageLimit = Math.max(1, backgroundBatchSize)
    let beforeCursor = oldestCreatedAt

    while (hasMore && beforeCursor) {
      let olderQuery = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .lt('created_at', beforeCursor)
        .order('created_at', { ascending: false })
        .limit(pageLimit + 1)

      if (clearedAt) {
        olderQuery = olderQuery.gt('created_at', clearedAt)
      }

      const { data: olderRows, error } = await olderQuery
      if (error || !olderRows) break

      hasMore = olderRows.length > pageLimit
      const olderPage = hasMore ? olderRows.slice(0, pageLimit) : olderRows
      const olderMessages = [...olderPage].reverse()

      if (olderMessages.length === 0) break

      const messageIds = olderMessages.map((message) => message.id)
      const enhancements = await fetchEnhancementsForMessageIds({
        messageIds,
        userLanguage,
        userProficiency,
      })

      messages = mergeMessages(messages, olderMessages)
      translations = { ...translations, ...enhancements.translations }
      scaledTexts = { ...scaledTexts, ...enhancements.scaledTexts }
      beforeCursor = olderMessages[0]?.created_at ?? null
      oldestCreatedAt = messages[0]?.created_at ?? null

      setMessageCache(conversationId, {
        messages,
        translations,
        scaledTexts,
        oldestCreatedAt,
        hasMore,
        clearedAt,
        cachedAt: Date.now(),
      })

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
