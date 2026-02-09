'use client'

import { useEffect, useState, memo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Conversation, ConversationWithOtherUser, AiChatSession } from '@/types/database'
import Link from 'next/link'
import Image from 'next/image'
import { getLanguageName } from '@/lib/constants/languages'
import { prefetchConversationMessages } from '@/lib/chat/messageCache'
import { prefetchAiSessionMessages } from '@/lib/chat/aiMessageCache'

type ChatListItem =
  | (ConversationWithOtherUser & { type: 'conversation' })
  | { type: 'ai'; session: AiChatSession }

function getItemUpdatedAt(item: ChatListItem): string {
  return item.type === 'ai' ? item.session.updated_at : item.conversations.updated_at
}

function getThreadHref(item: ChatListItem): string {
  if (item.type === 'ai') {
    return `/chat/ai/${item.session.id}`
  }

  if (item.conversations.is_group) {
    return `/chat/g/${item.conversation_id}`
  }

  return item.otherUser ? `/chat/${item.otherUser.username}` : '/chat'
}

function shouldRunHeavyPrefetch(): boolean {
  if (typeof navigator === 'undefined') {
    return true
  }

  type ConnectionInfo = {
    saveData?: boolean
    effectiveType?: string
  }

  const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection
  if (!connection) return true
  if (connection.saveData) return false
  if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
    return false
  }
  return true
}

const ChatListRow = memo(function ChatListRow({
  item,
  isSelected,
  href,
  hasUnread,
}: {
  item: ChatListItem
  isSelected: boolean
  href: string
  hasUnread: boolean
}) {
  const isAi = item.type === 'ai'
  const conv = item.type === 'conversation' ? item.conversations : null
  const displayName = isAi
    ? item.session.name || 'AI Chat'
    : conv?.is_group
      ? conv.group_name || 'Group Chat'
      : item.otherUser?.display_name || 'Direct Message'
  const avatarUrl = conv?.is_group
    ? conv.group_avatar_url
    : item.type === 'conversation'
      ? item.otherUser?.avatar_url
      : undefined
  const languageLabel = isAi ? getLanguageName(item.session.response_language) : null
  const levelLabel = isAi && item.session.response_level
    ? item.session.response_level.charAt(0).toUpperCase() + item.session.response_level.slice(1)
    : null
  const updatedAt = getItemUpdatedAt(item)
  const aiMeta = [languageLabel, levelLabel].filter(Boolean).join(' · ')

  return (
    <div className="relative">
      <Link
        href={href}
        scroll={false}
        data-testid="conversation-row"
        data-conversation-id={item.type === 'conversation' ? item.conversation_id : item.session.id}
        className={`chat-row block w-full p-4 text-left ${isSelected ? 'chat-row-selected' : ''
          }`}
      >
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {isAi ? (
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 font-semibold">
                AI
              </div>
            ) : conv?.is_group ? (
              // Group icon
              avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={displayName || 'Group'}
                  width={48}
                  height={48}
                  className="rounded-full object-cover"
                  style={{ width: 48, height: 48 }}
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-azure text-white">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
              )
            ) : avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName || 'User'}
                width={48}
                height={48}
                className="rounded-full object-cover"
                style={{ width: 48, height: 48 }}
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-azure text-white font-medium">
                {(displayName || '?').charAt(0).toUpperCase()}
              </div>
            )}
            {/* Unread indicator */}
            {hasUnread && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-red-500 border-2 border-white" />
            )}
          </div>

          {/* User info */}
          <div className="flex-1 min-w-0">
            <div className={`font-medium truncate ${hasUnread ? 'font-semibold' : ''}`}>{displayName}</div>
            {isAi ? (
              aiMeta ? <div className="text-sm text-gray-500 truncate">{aiMeta}</div> : null
            ) : conv?.is_group ? (
              <div className="text-sm text-gray-500 truncate">Group</div>
            ) : item.type === 'conversation' && item.otherUser ? (
              <div className="text-sm text-gray-500 truncate">@{item.otherUser.username}</div>
            ) : null}
            <div className="text-xs text-gray-500">
              {new Date(updatedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      </Link>
    </div>
  )
})

export default function ConversationList({
  userId,
  currentConversationId,
  currentAiSessionId,
  userLanguage,
  userProficiency,
}: {
  userId: string
  currentConversationId: string | null
  currentAiSessionId: string | null
  userLanguage: string
  userProficiency?: 'beginner' | 'intermediate' | 'advanced' | null
}) {
  const router = useRouter()
  const [threads, setThreads] = useState<ChatListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadConversations, setUnreadConversations] = useState<Set<string>>(new Set())
  const [unreadAiSessions, setUnreadAiSessions] = useState<Set<string>>(new Set())
  const prefetchedConversations = useRef<Set<string>>(new Set())
  const deepPrefetchedConversations = useRef<Set<string>>(new Set())
  const prefetchedAiSessions = useRef<Set<string>>(new Set())
  const deepPrefetchedAiSessions = useRef<Set<string>>(new Set())
  const prefetchedRoutes = useRef<Set<string>>(new Set())
  const currentConversationIdRef = useRef<string | null>(currentConversationId)
  const currentAiSessionIdRef = useRef<string | null>(currentAiSessionId)
  const hasLoadedOnceRef = useRef(false)

  const PREFETCH_MESSAGE_LIMIT = 30
  const PREFETCH_ITEM_DELAY_MS = 80
  const DEEP_PREFETCH_ITEM_DELAY_MS = 160
  const PREFETCH_BACKGROUND_BATCH_SIZE = 50
  const PREFETCH_BACKGROUND_PAUSE_MS = 120

  // Clear unread status when a conversation is selected
  useEffect(() => {
    if (currentConversationId) {
      setTimeout(() => {
        setUnreadConversations(prev => {
          const next = new Set(prev)
          next.delete(currentConversationId)
          return next
        })
      }, 0)
    }
  }, [currentConversationId])

  useEffect(() => {
    if (currentAiSessionId) {
      setTimeout(() => {
        setUnreadAiSessions(prev => {
          const next = new Set(prev)
          next.delete(currentAiSessionId)
          return next
        })
      }, 0)
    }
  }, [currentAiSessionId])

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId
  }, [currentConversationId])

  useEffect(() => {
    currentAiSessionIdRef.current = currentAiSessionId
  }, [currentAiSessionId])

  useEffect(() => {
    prefetchedConversations.current.clear()
    deepPrefetchedConversations.current.clear()
    prefetchedAiSessions.current.clear()
    deepPrefetchedAiSessions.current.clear()
    prefetchedRoutes.current.clear()
    hasLoadedOnceRef.current = false
  }, [userId, userLanguage, userProficiency])

  useEffect(() => {
    if (threads.length === 0) return

    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    threads.forEach((item, index) => {
      const timer = setTimeout(() => {
        if (cancelled) return

        const href = getThreadHref(item)
        if (!prefetchedRoutes.current.has(href)) {
          prefetchedRoutes.current.add(href)
          router.prefetch(href)
        }

        if (item.type === 'conversation') {
          const conversationId = item.conversation_id
          if (prefetchedConversations.current.has(conversationId)) return
          prefetchedConversations.current.add(conversationId)
          void prefetchConversationMessages({
            conversationId,
            userId,
            userLanguage,
            userProficiency,
            limit: PREFETCH_MESSAGE_LIMIT,
            prefetchAllMessages: false,
          })
          return
        }

        const sessionId = item.session.id
        if (prefetchedAiSessions.current.has(sessionId)) return
        prefetchedAiSessions.current.add(sessionId)
        void prefetchAiSessionMessages({
          sessionId,
          limit: PREFETCH_MESSAGE_LIMIT,
          prefetchAllMessages: false,
        })
      }, index * PREFETCH_ITEM_DELAY_MS)

      timers.push(timer)
    })

    return () => {
      cancelled = true
      timers.forEach((timer) => {
        clearTimeout(timer)
      })
    }
  }, [threads, router, userId, userLanguage, userProficiency])

  useEffect(() => {
    if (threads.length === 0) return
    if (!shouldRunHeavyPrefetch()) return

    let cancelled = false
    let nextTimer: ReturnType<typeof setTimeout> | null = null

    const deepPrefetchByIndex = async (index: number) => {
      if (cancelled || index >= threads.length) return

      const item = threads[index]

      try {
        if (item.type === 'conversation') {
          const conversationId = item.conversation_id
          if (!deepPrefetchedConversations.current.has(conversationId)) {
            deepPrefetchedConversations.current.add(conversationId)
            await prefetchConversationMessages({
              conversationId,
              userId,
              userLanguage,
              userProficiency,
              limit: PREFETCH_MESSAGE_LIMIT,
              prefetchAllMessages: true,
              backgroundBatchSize: PREFETCH_BACKGROUND_BATCH_SIZE,
              backgroundPauseMs: PREFETCH_BACKGROUND_PAUSE_MS,
            })
          }
        } else {
          const sessionId = item.session.id
          if (!deepPrefetchedAiSessions.current.has(sessionId)) {
            deepPrefetchedAiSessions.current.add(sessionId)
            await prefetchAiSessionMessages({
              sessionId,
              limit: PREFETCH_MESSAGE_LIMIT,
              prefetchAllMessages: true,
              backgroundBatchSize: PREFETCH_BACKGROUND_BATCH_SIZE,
              backgroundPauseMs: PREFETCH_BACKGROUND_PAUSE_MS,
            })
          }
        }
      } catch (error) {
        console.error('[ConversationList] Background deep prefetch failed:', error)
      }

      if (cancelled) return
      nextTimer = setTimeout(() => {
        void deepPrefetchByIndex(index + 1)
      }, DEEP_PREFETCH_ITEM_DELAY_MS)
    }

    const initialDelayMs = Math.max(240, threads.length * PREFETCH_ITEM_DELAY_MS)
    nextTimer = setTimeout(() => {
      void deepPrefetchByIndex(0)
    }, initialDelayMs)

    return () => {
      cancelled = true
      if (nextTimer) {
        clearTimeout(nextTimer)
      }
    }
  }, [threads, userId, userLanguage, userProficiency])

  useEffect(() => {
    const supabase = createClient()

    async function loadConversations({ showLoading = false }: { showLoading?: boolean } = {}) {
      if (showLoading || !hasLoadedOnceRef.current) {
        setLoading(true)
      }

      const [conversationResult, sessionResult] = await Promise.all([
        supabase
          .from('conversation_participants')
          .select(`
            conversation_id,
            hidden_at,
            conversations (
              id,
              is_group,
              group_name,
              group_avatar_url,
              updated_at
            )
          `)
          .eq('user_id', userId)
          .order('conversations(updated_at)', { ascending: false }),
        supabase
          .from('ai_chat_sessions')
          .select('id, user_id, name, response_language, response_level, created_at, updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false }),
      ])

      const { data, error } = conversationResult
      if (!error && data) {
        // Filter out conversations that are hidden and haven't received new messages
        const visibleData = data.filter((item) => {
          const conv = Array.isArray(item.conversations)
            ? (item.conversations[0] as Conversation | undefined)
            : (item.conversations as Conversation | undefined)
          if (!conv) return false
          // Show if not hidden, or if conversation was updated after being hidden
          if (!item.hidden_at) return true
          const isVisible = new Date(conv.updated_at) > new Date(item.hidden_at)
          console.log('[ConversationList] Checking visibility:', {
            conversationId: item.conversation_id,
            hidden_at: item.hidden_at,
            updated_at: conv.updated_at,
            isVisible,
          })
          return isVisible
        })

        const conversationIds = visibleData.map((item) => item.conversation_id)

        const otherUserMap: Record<string, { username: string; display_name: string; avatar_url?: string | null }> = {}

        if (conversationIds.length > 0) {
          // Use secure function to get other participants (avoids RLS recursion)
          // Fetch participants for each conversation using the secure function
          const participantPromises = conversationIds.map(async (convId) => {
            const { data: participants } = await supabase
              .rpc('get_conversation_participants_secure', { conv_id: convId })
            return { convId, participants }
          })

          const participantResults = await Promise.all(participantPromises)

          // Get unique user IDs that are not the current user
          const otherUserIds = new Set<string>()
          const convToUserMap: Record<string, string> = {}

          for (const { convId, participants } of participantResults) {
            if (participants) {
              for (const p of participants) {
                if (p.user_id !== userId) {
                  otherUserIds.add(p.user_id)
                  convToUserMap[convId] = p.user_id
                }
              }
            }
          }

          // Fetch profiles for other users
          if (otherUserIds.size > 0) {
            const { data: profiles } = await supabase
              .from('public_profiles')
              .select('id, username, display_name, avatar_url')
              .in('id', Array.from(otherUserIds))

            if (profiles) {
              const profileMap = new Map(profiles.map(p => [p.id, p]))
              for (const [convId, oderId] of Object.entries(convToUserMap)) {
                const profile = profileMap.get(oderId)
                if (profile) {
                  otherUserMap[convId] = profile
                }
              }
            }
          }
        }

        const conversationsWithUsers: ConversationWithOtherUser[] = visibleData.map((item) => {
          // Supabase can return a single object or an array depending on typing
          const conv = Array.isArray(item.conversations)
            ? (item.conversations[0] as Conversation | undefined)
            : (item.conversations as Conversation | undefined)
          if (!conv) {
            throw new Error('Conversation data missing for participant row')
          }

          if (!conv.is_group) {
            return {
              conversation_id: item.conversation_id,
              conversations: conv,
              otherUser: otherUserMap[item.conversation_id],
            }
          }

          return {
            conversation_id: item.conversation_id,
            conversations: conv,
          }
        })
        const sessionRows = sessionResult.data || []
        const aiSessions = sessionRows.map((session) => ({
          type: 'ai' as const,
          session: session as AiChatSession,
        }))
        const convItems = conversationsWithUsers.map((item) => ({
          ...item,
          type: 'conversation' as const,
        }))
        const combined = [...convItems, ...aiSessions].sort((a, b) => {
          return new Date(getItemUpdatedAt(b)).getTime() - new Date(getItemUpdatedAt(a)).getTime()
        })
        setThreads(combined)
      }
      hasLoadedOnceRef.current = true
      setLoading(false)
    }

    void loadConversations({ showLoading: true })

    // Subscribe to new conversations (when user is added as participant)
    const participantChannel = supabase
      .channel('conversation-participants')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_participants',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void loadConversations()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_participants',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Reload when hidden_at changes (conversation hidden or unhidden)
          void loadConversations()
        }
      )
      .subscribe()

    // Subscribe to conversation updates (for hidden conversations to reappear)
    // We subscribe to messages INSERT instead, which is more reliable
    // When a new message is inserted, we reload conversations to check visibility
    const messageChannel = supabase
      .channel('new-messages-for-conversations')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          console.log('[ConversationList] New message detected, reloading conversations')
          const newMessage = payload.new as { conversation_id: string; sender_id: string }

          // Mark conversation as unread if it's not currently selected and message is from someone else
          if (newMessage.conversation_id !== currentConversationIdRef.current && newMessage.sender_id !== userId) {
            setUnreadConversations(prev => new Set(prev).add(newMessage.conversation_id))
          }

          // Reload to check if any hidden conversations should now be visible
          void loadConversations()
        }
      )
      .subscribe()

    const aiSessionChannel = supabase
      .channel('ai-chat-sessions')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_chat_sessions',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void loadConversations()
        }
      )
      .subscribe()

    const aiMessageChannel = supabase
      .channel('new-messages-for-ai-sessions')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ai_chat_messages',
        },
        (payload) => {
          const newMessage = payload.new as { session_id: string; role: string }
          if (newMessage.session_id !== currentAiSessionIdRef.current && newMessage.role === 'assistant') {
            setUnreadAiSessions(prev => new Set(prev).add(newMessage.session_id))
          }
          void loadConversations()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(participantChannel)
      supabase.removeChannel(messageChannel)
      supabase.removeChannel(aiSessionChannel)
      supabase.removeChannel(aiMessageChannel)
    }
  }, [userId])

  if (loading) {
    return (
      <div aria-label="Loading conversations">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="p-4 animate-pulse">
            <div className="h-4 w-32 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-24 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    )
  }

  if (threads.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        No conversations yet. Start a new chat!
      </div>
    )
  }

  return (
    <div>
      {threads.map((item) => {
        const isSelected = item.type === 'ai'
          ? item.session.id === currentAiSessionId
          : item.conversation_id === currentConversationId
        const href = getThreadHref(item)
        const hasUnread = item.type === 'ai'
          ? unreadAiSessions.has(item.session.id)
          : unreadConversations.has(item.conversation_id)

        return (
          <ChatListRow
            key={item.type === 'ai' ? item.session.id : item.conversation_id}
            item={item}
            isSelected={isSelected}
            href={href}
            hasUnread={hasUnread}
          />
        )
      })}
    </div>
  )
}
