'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { User } from '@supabase/supabase-js'
import { Profile, AiChatSession } from '@/types/database'
import MessageList from '@/components/chat/MessageList'
import MessageInput from '@/components/chat/MessageInput'
import AiMessageList from '@/components/ai/AiMessageList'
import AiMessageInput from '@/components/ai/AiMessageInput'
import AiSessionModal, { AiSessionFormValues } from '@/components/ai/AiSessionModal'
import ChatSettingsModal from '@/components/chat/ChatSettingsModal'
import AddGroupMembersModal from '@/components/chat/AddGroupMembersModal'
import { useAppShell } from '@/components/layout/AppShell'
import { usePresence } from '@/hooks/usePresence'
import { useUserPresence } from '@/hooks/useUserPresence'
import { getPresenceStatus } from '@/lib/utils/presence'
import { createClient } from '@/lib/supabase/client'
import { clearChatHistoryForUser, deleteConversationForUser } from '@/lib/chat/conversations'
import { getLanguageName } from '@/lib/constants/languages'

type OtherUserProfile = {
  display_name: string
  avatar_url?: string
}

type ConversationInfo = {
  isGroup: boolean
  groupName?: string | null
  groupAvatarUrl?: string | null
  memberCount?: number
}

export default function ChatInterface({
  user,
  profile,
  initialConversationId = null,
  initialAiSessionId = null,
  otherUsername = null,
}: {
  user: User
  profile: Profile
  initialConversationId?: string | null
  initialAiSessionId?: string | null
  otherUsername?: string | null
}) {
  usePresence(user.id, profile.username)
  
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialConversationId
  )
  const [selectedAiSessionId, setSelectedAiSessionId] = useState<string | null>(
    initialAiSessionId
  )
  const [selectedAiSession, setSelectedAiSession] = useState<AiChatSession | null>(null)
  const [otherUserProfile, setOtherUserProfile] = useState<OtherUserProfile | null>(null)
  const [conversationInfo, setConversationInfo] = useState<ConversationInfo | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [showChatSettings, setShowChatSettings] = useState(false)
  const [showAddMembersModal, setShowAddMembersModal] = useState(false)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [savingAiSettings, setSavingAiSettings] = useState(false)
  const [messageListKey, setMessageListKey] = useState(0)
  const [isResponding, setIsResponding] = useState(false)
  const [aiMessageRefreshKey, setAiMessageRefreshKey] = useState(0)
  const router = useRouter()
  const { setCurrentConversationId, setCurrentAiSessionId } = useAppShell()
  const supabase = useMemo(() => createClient(), [])

  const handleDeleteConversation = async () => {
    if (!selectedConversationId || isDeleting) return
    
    const displayName = conversationInfo?.isGroup 
      ? conversationInfo.groupName || 'Group Chat'
      : otherUserProfile?.display_name || 'this user'
    
    if (!confirm(`Delete conversation with ${displayName}?`)) return
    
    setIsDeleting(true)
    try {
      await deleteConversationForUser(selectedConversationId, user.id)
      setSelectedConversationId(null)
      router.push('/chat')
    } catch (error) {
      console.error('Error deleting conversation:', error)
      alert('Failed to delete conversation. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleClearConversation = async () => {
    if (!selectedConversationId || isClearing) return
    if (!confirm('Clear chat history for this conversation?')) return

    setIsClearing(true)
    try {
      await clearChatHistoryForUser(selectedConversationId, user.id)
      setMessageListKey((prev) => prev + 1)
      setShowChatSettings(false)
    } catch (error) {
      console.error('Error clearing conversation:', error)
      alert('Failed to clear chat history. Please try again.')
    } finally {
      setIsClearing(false)
    }
  }

  const { isOnline, lastSeen } = useUserPresence(otherUsername || '')

  const presenceStatus = lastSeen
    ? {
        isOnline: isOnline,
        lastSeenText: isOnline ? 'Online' : getPresenceStatus(lastSeen).lastSeenText,
      }
    : null

  // Fetch other user's profile when username changes
  useEffect(() => {
    async function fetchOtherUserProfile() {
      if (!otherUsername || selectedAiSessionId) {
        setOtherUserProfile(null)
        return
      }

      const { data, error } = await supabase
        .from('public_profiles')
        .select('display_name, avatar_url')
        .eq('username', otherUsername)
        .single()

      if (!error && data) {
        setOtherUserProfile(data)
      }
    }

    fetchOtherUserProfile()
  }, [otherUsername, selectedAiSessionId, supabase])

  const fetchConversationInfo = useCallback(async (conversationId: string | null) => {
    if (!conversationId) {
      setConversationInfo(null)
      return
    }

    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('is_group, group_name, group_avatar_url')
      .eq('id', conversationId)
      .single()

    if (convError || !conv) {
      setConversationInfo(null)
      return
    }

    if (conv.is_group) {
      const { data: participants } = await supabase
        .rpc('get_conversation_participants_secure', { conv_id: conversationId })

      setConversationInfo({
        isGroup: true,
        groupName: conv.group_name,
        groupAvatarUrl: conv.group_avatar_url,
        memberCount: participants?.length || 0,
      })
    } else {
      setConversationInfo({ isGroup: false })
    }
  }, [supabase])

  // Fetch conversation info (for group chats)
  useEffect(() => {
    fetchConversationInfo(selectedConversationId)
  }, [selectedConversationId, fetchConversationInfo])

  useEffect(() => {
    if (initialConversationId) {
      setSelectedConversationId(initialConversationId)
      setSelectedAiSessionId(null)
      return
    }
    if (initialAiSessionId) {
      setSelectedAiSessionId(initialAiSessionId)
      setSelectedConversationId(null)
      return
    }
    setSelectedConversationId(null)
    setSelectedAiSessionId(null)
  }, [initialConversationId, initialAiSessionId])

  useEffect(() => {
    setCurrentConversationId(selectedConversationId)
    setCurrentAiSessionId(selectedAiSessionId)
  }, [selectedConversationId, selectedAiSessionId, setCurrentConversationId, setCurrentAiSessionId])

  useEffect(() => {
    setIsResponding(false)
    if (selectedAiSessionId) {
      setAiMessageRefreshKey((prev) => prev + 1)
    }
  }, [selectedAiSessionId])

  useEffect(() => {
    setShowChatSettings(false)
    setShowAiSettings(false)
    setShowAddMembersModal(false)
  }, [selectedConversationId, selectedAiSessionId])

  useEffect(() => {
    async function loadAiSession() {
      if (!selectedAiSessionId) {
        setSelectedAiSession(null)
        return
      }

      const { data, error } = await supabase
        .from('ai_chat_sessions')
        .select('*')
        .eq('id', selectedAiSessionId)
        .single()

      if (error || !data) {
        setSelectedAiSession(null)
        setSelectedAiSessionId(null)
        router.push('/chat')
        return
      }

      setSelectedAiSession(data as AiChatSession)
    }

    loadAiSession()
  }, [selectedAiSessionId, supabase, router])

  function openSettings() {
    if (selectedAiSessionId) {
      setShowAiSettings(true)
    } else if (selectedConversationId) {
      setShowChatSettings(true)
    }
  }

  function getAiModalInitialValues(): AiSessionFormValues {
    if (!selectedAiSession) {
      return {
        name: '',
        responseLanguage: '',
        responseLevel: '',
        systemPrompt: '',
      }
    }

    return {
      name: selectedAiSession.name || '',
      responseLanguage: selectedAiSession.response_language || '',
      responseLevel: (selectedAiSession.response_level || '') as AiSessionFormValues['responseLevel'],
      systemPrompt: selectedAiSession.system_prompt || '',
    }
  }

  async function handleSaveAiSettings(values: AiSessionFormValues) {
    if (!selectedAiSessionId) return

    setSavingAiSettings(true)
    const trimmedName = values.name.trim() || 'AI Chat'
    const payload = {
      name: trimmedName,
      response_language: values.responseLanguage || null,
      response_level: values.responseLevel || null,
      system_prompt: values.systemPrompt.trim() || null,
      updated_at: new Date().toISOString(),
    }

    try {
      const { data, error } = await supabase
        .from('ai_chat_sessions')
        .update(payload)
        .eq('id', selectedAiSessionId)
        .select()
        .single()

      if (error || !data) {
        throw error || new Error('Failed to update AI chat')
      }

      setSelectedAiSession(data as AiChatSession)
      setShowAiSettings(false)
    } catch (error) {
      console.error('[ChatInterface] Failed to save AI chat settings:', error)
      alert('Failed to save AI chat settings')
    } finally {
      setSavingAiSettings(false)
    }
  }

  const aiSessionMeta = selectedAiSession
    ? [
        getLanguageName(selectedAiSession.response_language),
        selectedAiSession.response_level
          ? selectedAiSession.response_level.charAt(0).toUpperCase() + selectedAiSession.response_level.slice(1)
          : null,
      ].filter(Boolean).join(' · ')
    : ''

  return (
    <>
      <div className="flex flex-1 flex-col min-h-0">
        {selectedAiSessionId ? (
          selectedAiSession ? (
            <>
              <div className="bg-chat-panel p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 font-semibold">
                      AI
                    </div>
                    <div>
                      <h3 className="font-medium">{selectedAiSession.name || 'AI Chat'}</h3>
                      {aiSessionMeta && (
                        <p className="text-sm text-gray-500">{aiSessionMeta}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={openSettings}
                    className="p-2 rounded-lg text-gray-600 hover:text-gray-700 hover:bg-gray-100 border border-transparent hover:border-gray-200 transition-colors"
                    aria-label="Chat settings"
                    title="Chat settings"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>
              </div>
              <AiMessageList
                sessionId={selectedAiSessionId}
                userId={user.id}
                feedbackLanguage={profile.feedback_language || profile.language_preference}
                autoCorrectionEnabled={profile.auto_correction_enabled}
                isResponding={isResponding}
                refreshKey={aiMessageRefreshKey}
                defaultSpeechLanguage={selectedAiSession.response_language || profile.language_preference}
                defaultSpeechVoice={profile.tts_voice || null}
                defaultSpeechRate={profile.tts_rate ?? 0}
              />
              <AiMessageInput
                sessionId={selectedAiSessionId}
                onRespondingChange={setIsResponding}
                disabled={isResponding}
                onMessagesUpdated={() => setAiMessageRefreshKey((prev) => prev + 1)}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-500">
              Loading AI chat...
            </div>
          )
        ) : selectedConversationId ? (
          <>
            <div className="bg-chat-panel p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                {/* Avatar */}
                {conversationInfo?.isGroup ? (
                  // Group avatar
                  <div className="relative flex-shrink-0">
                    {conversationInfo.groupAvatarUrl ? (
                      <Image
                        src={conversationInfo.groupAvatarUrl}
                        alt={conversationInfo.groupName || 'Group'}
                        width={40}
                        height={40}
                        className="rounded-full object-cover"
                        style={{ width: 40, height: 40 }}
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-azure text-white font-medium">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                      </div>
                    )}
                  </div>
                ) : otherUserProfile && (
                  // Direct message avatar - clickable to profile
                  <button
                    onClick={() => otherUsername && router.push(`/profile/${otherUsername}`)}
                    className="relative flex-shrink-0 hover:opacity-80 transition-opacity"
                  >
                    {otherUserProfile.avatar_url ? (
                      <Image
                        src={otherUserProfile.avatar_url}
                        alt={otherUserProfile.display_name}
                        width={40}
                        height={40}
                        className="rounded-full object-cover"
                        style={{ width: 40, height: 40 }}
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-300 text-gray-700 font-medium">
                        {otherUserProfile.display_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </button>
                )}
                <div>
                  {conversationInfo?.isGroup ? (
                    <>
                      <h3 className="font-medium">{conversationInfo.groupName || 'Group Chat'}</h3>
                      <p className="text-sm text-gray-500">{conversationInfo.memberCount} members</p>
                    </>
                  ) : (
                    <button
                      onClick={() => otherUsername && router.push(`/profile/${otherUsername}`)}
                      className="text-left hover:opacity-80 transition-opacity"
                    >
                      <h3 className="font-medium">
                        {otherUserProfile?.display_name || (otherUsername ? `@${otherUsername}` : 'Conversation')}
                      </h3>
                      {otherUsername && (
                        <p className="text-sm text-gray-500">@{otherUsername}</p>
                      )}
                      {presenceStatus && (
                        <p className="text-xs text-gray-500">{presenceStatus.lastSeenText}</p>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Chat Settings Button */}
              <button
                onClick={openSettings}
                className="p-2 rounded-lg text-gray-600 hover:text-gray-700 hover:bg-gray-100 border border-transparent hover:border-gray-200 transition-colors"
                aria-label="Chat settings"
                title="Chat settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
            <MessageList
              key={`${selectedConversationId}-${messageListKey}`}
              conversationId={selectedConversationId}
              userId={user.id}
              userLanguage={profile.language_preference}
              feedbackLanguage={profile.feedback_language || profile.language_preference}
              autoCorrectionEnabled={profile.auto_correction_enabled}
              userProficiency={profile.language_proficiency}
              speechVoice={profile.tts_voice || null}
              speechRate={profile.tts_rate ?? 0}
              isGroup={conversationInfo?.isGroup || false}
            />
            <MessageInput
              conversationId={selectedConversationId}
              userId={user.id}
              userLanguage={profile.language_preference}
              feedbackLanguage={profile.feedback_language || profile.language_preference}
              autoCorrectionEnabled={profile.auto_correction_enabled}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-gray-500">
            Select a conversation to start chatting
          </div>
        )}
      </div>

      {showChatSettings && selectedConversationId && (
        <ChatSettingsModal
          title={conversationInfo?.isGroup ? (conversationInfo.groupName || 'Group Chat') : (otherUserProfile?.display_name || 'Conversation')}
          onClose={() => setShowChatSettings(false)}
          onClearChat={handleClearConversation}
          onDeleteChat={handleDeleteConversation}
          onAddMembers={
            conversationInfo?.isGroup
              ? () => {
                  setShowChatSettings(false)
                  setShowAddMembersModal(true)
                }
              : undefined
          }
          clearing={isClearing}
          deleting={isDeleting}
        />
      )}

      {showAddMembersModal && selectedConversationId && (
        <AddGroupMembersModal
          conversationId={selectedConversationId}
          currentUserId={user.id}
          onClose={() => setShowAddMembersModal(false)}
          onMembersAdded={() => fetchConversationInfo(selectedConversationId)}
        />
      )}

      {showAiSettings && selectedAiSession && (
        <AiSessionModal
          mode="edit"
          initialValues={getAiModalInitialValues()}
          saving={savingAiSettings}
          onSave={handleSaveAiSettings}
          onClose={() => setShowAiSettings(false)}
        />
      )}
    </>
  )
}
