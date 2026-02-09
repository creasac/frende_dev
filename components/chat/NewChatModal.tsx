'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PublicProfile } from '@/types/database'
import { getOrCreateDirectConversation, createConversation } from '@/lib/chat/conversations'
import { LANGUAGES } from '@/lib/constants/languages'

function defaultAiName() {
  const date = new Date().toISOString().slice(0, 10)
  return `AI ${date}`
}

export default function NewChatModal({
  currentUserId,
  onClose,
  onConversationCreated,
  isAuthenticated,
  requireAuth,
}: {
  currentUserId: string | null
  onClose: () => void
  onConversationCreated: (conversationId: string, username?: string) => void
  isAuthenticated: boolean
  requireAuth: (message?: string) => boolean
}) {
  const [users, setUsers] = useState<PublicProfile[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState<'direct' | 'group' | 'ai'>('direct')
  const [selectedUsers, setSelectedUsers] = useState<PublicProfile[]>([])
  const [groupName, setGroupName] = useState('')
  const [aiName, setAiName] = useState(() => defaultAiName())
  const [aiResponseLanguage, setAiResponseLanguage] = useState('')
  const [aiResponseLevel, setAiResponseLevel] = useState<'beginner' | 'intermediate' | 'advanced' | ''>('')
  const [aiSystemPrompt, setAiSystemPrompt] = useState('')
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const searchUsers = useCallback(async () => {
    setLoading(true)
    const query = supabase
      .from('public_profiles')
      .select('id, username, display_name, bio, avatar_url')
      .limit(20)

    if (currentUserId) {
      query.neq('id', currentUserId)
    }

    if (searchTerm) {
      query.or(`username.ilike.%${searchTerm}%,display_name.ilike.%${searchTerm}%`)
    }

    const { data, error } = await query

    if (!error && data) {
      setUsers(data)
    }
    setLoading(false)
  }, [currentUserId, searchTerm, supabase])

  useEffect(() => {
    if (mode === 'ai') return
    searchUsers()
  }, [mode, searchUsers])

  useEffect(() => {
    if (mode === 'ai' && !aiName.trim()) {
      setAiName(defaultAiName())
    }
  }, [mode, aiName])

  async function handleCreateChat(otherUser: PublicProfile) {
    if (!isAuthenticated || !currentUserId) {
      requireAuth('Log in to start a chat.')
      return
    }

    setCreating(true)
    try {
      // Use the new function that checks for existing conversations
      const conversationId = await getOrCreateDirectConversation(
        currentUserId,
        otherUser.id
      )
      
      onConversationCreated(conversationId, otherUser.username)
      onClose()
    } catch (error) {
      console.error('Failed to create conversation:', error)
      alert('Failed to create conversation')
    } finally {
      setCreating(false)
    }
  }

  async function handleCreateAiChat() {
    if (!isAuthenticated || !currentUserId) {
      requireAuth('Log in to start an AI chat.')
      return
    }
    if (creating) return
    setCreating(true)

    try {
      const name = aiName.trim() || defaultAiName()
      const { data, error } = await supabase
        .from('ai_chat_sessions')
        .insert({
          user_id: currentUserId,
          name,
          response_language: aiResponseLanguage || null,
          response_level: aiResponseLevel || null,
          system_prompt: aiSystemPrompt.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error || !data) {
        throw error || new Error('Failed to create AI chat')
      }

      onClose()
      router.push(`/chat/ai/${data.id}`)
    } catch (error) {
      console.error('Failed to create AI chat:', error)
      alert('Failed to create AI chat')
    } finally {
      setCreating(false)
    }
  }

  function toggleUserSelection(user: PublicProfile) {
    setSelectedUsers(prev => {
      const isSelected = prev.some(u => u.id === user.id)
      if (isSelected) {
        return prev.filter(u => u.id !== user.id)
      } else {
        return [...prev, user]
      }
    })
  }

  async function handleCreateGroup() {
    if (!isAuthenticated || !currentUserId) {
      requireAuth('Log in to create a group chat.')
      return
    }
    if (selectedUsers.length < 2) {
      alert('Please select at least 2 people for a group')
      return
    }
    if (!groupName.trim()) {
      alert('Please enter a group name')
      return
    }

    setCreating(true)
    try {
      const participantIds = [currentUserId, ...selectedUsers.map(u => u.id)]
      const conversation = await createConversation(participantIds, true, groupName.trim())
      onConversationCreated(conversation.id)
      onClose()
    } catch (error) {
      console.error('Failed to create group:', error)
      alert('Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-md rounded-lg bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">
            {mode === 'direct' ? 'New Chat' : mode === 'group' ? 'New Group' : 'New AI Chat'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        {!isAuthenticated && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Sign in to start chats. You can still browse people and preview options.
          </div>
        )}

        {/* Mode Toggle */}
        <div className="mb-4 flex rounded-lg bg-gray-100 p-1">
          <button
            onClick={() => { setMode('direct'); setSelectedUsers([]); }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === 'direct' ? 'bg-white shadow-sm' : 'text-gray-600'
            }`}
          >
            Direct Message
          </button>
          <button
            onClick={() => setMode('group')}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === 'group' ? 'bg-white shadow-sm' : 'text-gray-600'
            }`}
          >
            Group Chat
          </button>
          <button
            onClick={() => { setMode('ai'); setSelectedUsers([]); }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === 'ai' ? 'bg-white shadow-sm' : 'text-gray-600'
            }`}
          >
            AI Chat
          </button>
        </div>

        {/* Group Name Input (only for group mode) */}
        {mode === 'group' && (
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Enter group name..."
            className="mb-3 w-full rounded border border-gray-300 px-3 py-2"
          />
        )}

        {/* AI Chat Settings (only for ai mode) */}
        {mode === 'ai' && (
          <div className="space-y-3">
            <input
              type="text"
              value={aiName}
              onChange={(e) => setAiName(e.target.value)}
              placeholder="AI 2025-01-31"
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
            <select
              value={aiResponseLanguage}
              onChange={(e) => setAiResponseLanguage(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Response language (optional)</option>
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
            <select
              value={aiResponseLevel}
              onChange={(e) => setAiResponseLevel(e.target.value as typeof aiResponseLevel)}
              className="w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Response level (optional)</option>
              <option value="beginner">Beginner (A1-A2)</option>
              <option value="intermediate">Intermediate (B1-B2)</option>
              <option value="advanced">Advanced (C1-C2)</option>
            </select>
            <textarea
              value={aiSystemPrompt}
              onChange={(e) => setAiSystemPrompt(e.target.value)}
              placeholder="System prompt (optional)"
              className="min-h-[100px] w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        )}

        {/* Selected Users (only for group mode) */}
        {mode === 'group' && selectedUsers.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {selectedUsers.map(user => (
              <span
                key={user.id}
                className="inline-flex items-center gap-1 rounded-full bg-azure/10 px-3 py-1 text-sm text-azure"
              >
                {user.display_name}
                <button
                  onClick={() => toggleUserSelection(user)}
                  className="hover:text-azure/70"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {mode !== 'ai' && (
          <>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search users by username or name..."
              className="mb-4 w-full rounded border border-gray-300 px-3 py-2"
            />

            <div className="max-h-64 overflow-y-auto">
              {loading ? (
                <div className="py-4 text-center text-gray-500">Loading...</div>
              ) : users.length === 0 ? (
                <div className="py-4 text-center text-gray-500">No users found</div>
              ) : (
                <div className="space-y-2">
                  {users.map((user) => {
                    const isSelected = selectedUsers.some(u => u.id === user.id)
                    return (
                      <button
                        key={user.id}
                        onClick={() => mode === 'direct' ? handleCreateChat(user) : toggleUserSelection(user)}
                        disabled={creating}
                        className={`w-full rounded p-3 text-left hover:bg-gray-100 disabled:opacity-50 flex items-center gap-3 ${
                          isSelected ? 'bg-azure/10 border border-azure' : ''
                        }`}
                      >
                        {/* User avatar */}
                        {user.avatar_url ? (
                          <Image
                            src={user.avatar_url}
                            alt={user.display_name}
                            width={40}
                            height={40}
                            className="rounded-full object-cover flex-shrink-0"
                            style={{ width: 40, height: 40 }}
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-azure text-white font-medium flex-shrink-0">
                            {user.display_name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{user.display_name}</div>
                          <div className="text-sm text-gray-500 truncate">@{user.username}</div>
                        </div>
                        {mode === 'group' && isSelected && (
                          <svg className="h-5 w-5 text-azure flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Create Group Button */}
        {mode === 'group' && (
          <button
            onClick={handleCreateGroup}
            disabled={creating || (isAuthenticated && (selectedUsers.length < 2 || !groupName.trim()))}
            className="mt-4 w-full rounded-lg bg-azure py-2 text-white hover:bg-azure/90 disabled:bg-gray-400"
          >
            {creating ? 'Creating...' : `Create Group (${selectedUsers.length} selected)`}
          </button>
        )}

        {/* Create AI Chat Button */}
        {mode === 'ai' && (
          <button
            onClick={handleCreateAiChat}
            disabled={creating}
            className="mt-4 w-full rounded-lg bg-azure py-2 text-white hover:bg-azure/90 disabled:bg-gray-400"
          >
            {creating ? 'Creating...' : 'Create AI Chat'}
          </button>
        )}
      </div>
    </div>
  )
}
