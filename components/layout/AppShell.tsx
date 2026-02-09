'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import ConversationList from '@/components/chat/ConversationList'
import NewChatModal from '@/components/chat/NewChatModal'
import type { Profile } from '@/types/database'

type AppShellContextValue = {
  currentConversationId: string | null
  currentAiSessionId: string | null
  setCurrentConversationId: (id: string | null) => void
  setCurrentAiSessionId: (id: string | null) => void
  profile: Profile | null
  isAuthenticated: boolean
  requireAuth: (message?: string) => boolean
}

const AppShellContext = createContext<AppShellContextValue | null>(null)

export function useAppShell() {
  const context = useContext(AppShellContext)
  if (!context) {
    throw new Error('useAppShell must be used within AppShell')
  }
  return context
}

export default function AppShell({
  profile,
  children,
}: {
  profile: Profile | null
  children: React.ReactNode
}) {
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [currentAiSessionId, setCurrentAiSessionId] = useState<string | null>(null)
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [authPrompt, setAuthPrompt] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  })
  const prefetchedStaticRoutesRef = useRef<Set<string>>(new Set())
  const router = useRouter()
  const pathname = usePathname()
  const isAuthenticated = Boolean(profile)

  const requireAuth = useCallback((message?: string) => {
    if (isAuthenticated) return true
    setAuthPrompt({
      open: true,
      message: message || 'Log in to continue.',
    })
    return false
  }, [isAuthenticated])

  useEffect(() => {
    if (!pathname.startsWith('/chat')) {
      setTimeout(() => {
        setCurrentConversationId(null)
        setCurrentAiSessionId(null)
      }, 0)
    }
  }, [pathname])

  useEffect(() => {
    const routesToPrefetch = ['/', '/chat', '/play', '/discover']
    if (isAuthenticated) {
      routesToPrefetch.push('/settings')
      if (profile?.username) {
        routesToPrefetch.push(`/profile/${profile.username}`)
      }
    }

    const timers = routesToPrefetch.map((route, index) => (
      setTimeout(() => {
        if (prefetchedStaticRoutesRef.current.has(route)) return
        prefetchedStaticRoutesRef.current.add(route)
        router.prefetch(route)
      }, index * 120)
    ))

    return () => {
      timers.forEach((timer) => {
        clearTimeout(timer)
      })
    }
  }, [router, isAuthenticated, profile?.username])

  const contextValue = useMemo(
    () => ({
      currentConversationId,
      currentAiSessionId,
      setCurrentConversationId,
      setCurrentAiSessionId,
      profile,
      isAuthenticated,
      requireAuth,
    }),
    [currentConversationId, currentAiSessionId, profile, isAuthenticated, requireAuth]
  )

  return (
    <AppShellContext.Provider value={contextValue}>
      <div className="flex h-screen overflow-hidden bg-white">
        <aside className="w-80 bg-chat-panel flex flex-col min-h-0">
          <div className="p-4">
            <div className="flex w-full items-center justify-evenly">
              <button
                onClick={() => router.push('/')}
                className="h-11 w-11 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                aria-label="Home"
                title="Home"
              >
                <svg className="h-6 w-6 block" fill="none" stroke="currentColor" viewBox="0 0.5 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10.5L12 3l9 7.5M5 9.5V20a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9.5" />
                </svg>
              </button>
              <button
                onClick={() => router.push('/play')}
                className="h-11 w-11 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                aria-label="Playground"
                title="Playground"
              >
                <svg className="h-8 w-8 block" fill="none" stroke="currentColor" viewBox="0 -2 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2L12 3z" />
                </svg>
              </button>
              <button
                onClick={() => router.push('/discover')}
                className="h-11 w-11 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                aria-label="Discover People"
                title="Discover People"
              >
                <svg className="h-6 w-6 block" fill="none" stroke="currentColor" viewBox="0 0.5 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </button>
            </div>
            <button
              onClick={() => setShowNewChatModal(true)}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50"
              aria-label="Chat"
              title="Chat"
            >
              <svg className="h-5 w-5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z" />
                <path
                  fillRule="evenodd"
                  d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"
                />
              </svg>
              <span className="text-sm font-medium">Chat</span>
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-slim">
            {profile ? (
              <ConversationList
                userId={profile.id}
                currentConversationId={currentConversationId}
                currentAiSessionId={currentAiSessionId}
                userLanguage={profile.language_preference}
                userProficiency={profile.language_proficiency}
              />
            ) : (
              <div className="p-4 text-sm text-gray-500">
                Sign in to see your conversations.
              </div>
            )}
          </div>

          <div className="p-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (!requireAuth('Log in to view your profile.')) return
                  router.push(`/profile/${profile?.username ?? ''}`)
                }}
                className="flex-shrink-0 hover:opacity-80 transition-opacity"
              >
                {profile?.avatar_url ? (
                  <Image
                    src={profile.avatar_url}
                    alt={profile.display_name}
                    width={44}
                    height={44}
                    className="rounded-full object-cover"
                    style={{ width: 44, height: 44 }}
                  />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-azure text-white font-medium text-lg">
                    {(profile?.display_name || 'G').charAt(0).toUpperCase()}
                  </div>
                )}
              </button>
              <button
                onClick={() => {
                  if (!requireAuth('Log in to view your profile.')) return
                  router.push(`/profile/${profile?.username ?? ''}`)
                }}
                className="flex-1 text-left hover:opacity-80 transition-opacity min-w-0"
              >
                <h2 className="text-base font-semibold truncate">
                  {profile?.display_name || 'Guest'}
                </h2>
                <p className="text-xs text-gray-500 truncate">
                  {profile ? `@${profile.username}` : 'Sign in to sync chats'}
                </p>
              </button>
              {isAuthenticated && (
                <button
                  onClick={() => {
                    router.push('/settings')
                  }}
                  className="h-11 w-11 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  aria-label="Settings"
                  title="Settings"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </aside>

        <main className="flex flex-col flex-1 min-h-0 overflow-y-auto bg-gray-50 scrollbar-slim">
          {children}
        </main>
      </div>

      {showNewChatModal && (
        <NewChatModal
          currentUserId={profile?.id ?? null}
          onClose={() => setShowNewChatModal(false)}
          onConversationCreated={(id, username) => {
            setShowNewChatModal(false)
            if (username) {
              router.push(`/chat/${username}`)
            } else {
              router.push(`/chat/g/${id}`)
            }
          }}
          isAuthenticated={isAuthenticated}
          requireAuth={requireAuth}
        />
      )}

      {authPrompt.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-lg font-semibold text-gray-900">Sign in required</h3>
            <p className="mt-2 text-sm text-gray-600">
              {authPrompt.message || 'Log in to continue.'}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setAuthPrompt({ open: false, message: '' })
                  router.push('/login')
                }}
                className="flex-1 rounded-lg bg-azure px-3 py-2 text-sm font-medium text-white hover:bg-azure/90"
              >
                Log in
              </button>
              <button
                onClick={() => setAuthPrompt({ open: false, message: '' })}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShellContext.Provider>
  )
}
