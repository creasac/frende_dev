'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { PublicProfile } from '@/types/database'

type ParticipantRow = {
  user_id: string
}

export default function AddGroupMembersModal({
  conversationId,
  currentUserId,
  onClose,
  onMembersAdded,
}: {
  conversationId: string
  currentUserId: string
  onClose: () => void
  onMembersAdded?: (userIds: string[]) => void
}) {
  const [users, setUsers] = useState<PublicProfile[]>([])
  const [selectedUsers, setSelectedUsers] = useState<PublicProfile[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [excludedUserIds, setExcludedUserIds] = useState<string[]>([])
  const [participantsLoaded, setParticipantsLoaded] = useState(false)
  const supabase = useMemo(() => createClient(), [])

  const searchUsers = useCallback(async () => {
    setLoading(true)
    const query = supabase
      .from('public_profiles')
      .select('id, username, display_name, bio, avatar_url')
      .limit(20)

    if (searchTerm) {
      query.or(`username.ilike.%${searchTerm}%,display_name.ilike.%${searchTerm}%`)
    }

    const { data, error } = await query

    if (!error && data) {
      const excludedIdSet = new Set([currentUserId, ...excludedUserIds])
      const filtered = data.filter((user) => !excludedIdSet.has(user.id))
      setUsers(filtered)
    } else {
      setUsers([])
    }
    setLoading(false)
  }, [currentUserId, excludedUserIds, searchTerm, supabase])

  useEffect(() => {
    async function fetchParticipants() {
      setParticipantsLoaded(false)
      const { data } = await supabase
        .rpc('get_conversation_participants_secure', { conv_id: conversationId })

      if (data) {
        setExcludedUserIds(data.map((row: ParticipantRow) => row.user_id))
      }
      setParticipantsLoaded(true)
    }

    fetchParticipants()
  }, [conversationId, supabase])

  useEffect(() => {
    if (!participantsLoaded) return
    searchUsers()
  }, [participantsLoaded, searchUsers])

  function toggleUserSelection(user: PublicProfile) {
    setSelectedUsers(prev => {
      const isSelected = prev.some(u => u.id === user.id)
      if (isSelected) {
        return prev.filter(u => u.id !== user.id)
      }
      return [...prev, user]
    })
  }

  async function handleAddMembers() {
    if (adding || selectedUsers.length === 0) return
    if (!participantsLoaded) return

    setAdding(true)
    try {
      const excludedIdSet = new Set([currentUserId, ...excludedUserIds])
      const validUsers = selectedUsers.filter((user) => !excludedIdSet.has(user.id))

      if (validUsers.length === 0) {
        alert('No new members selected')
        return
      }

      const participants = validUsers.map((user) => ({
        conversation_id: conversationId,
        user_id: user.id,
        is_admin: false,
      }))

      const { error } = await supabase
        .from('conversation_participants')
        .insert(participants)

      if (error) throw error

      onMembersAdded?.(validUsers.map(user => user.id))
      onClose()
    } catch (error) {
      console.error('Failed to add members:', error)
      alert('Failed to add members')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Add members</h2>
            <p className="text-sm text-gray-500">Invite people to this group.</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            Close
          </button>
        </div>

        {selectedUsers.length > 0 && (
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
                  x
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search users by username or name..."
          disabled={!participantsLoaded}
          className="mb-4 w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100"
        />

        <div className="max-h-64 overflow-y-auto">
          {!participantsLoaded ? (
            <div className="py-4 text-center text-gray-500">Loading members...</div>
          ) : loading ? (
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
                    onClick={() => toggleUserSelection(user)}
                    disabled={adding}
                    className={`w-full rounded p-3 text-left hover:bg-gray-100 disabled:opacity-50 flex items-center gap-3 ${
                      isSelected ? 'bg-azure/10 border border-azure' : ''
                    }`}
                  >
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
                    {isSelected && (
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

        <button
          onClick={handleAddMembers}
          disabled={adding || selectedUsers.length === 0 || !participantsLoaded}
          className="mt-4 w-full rounded-lg bg-azure py-2 text-white hover:bg-azure/90 disabled:bg-gray-400"
        >
          {adding ? 'Adding...' : `Add members (${selectedUsers.length} selected)`}
        </button>
      </div>
    </div>
  )
}
