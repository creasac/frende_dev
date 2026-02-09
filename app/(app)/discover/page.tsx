'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { PublicProfile } from '@/types/database'

export default function DiscoverPage() {
  const [users, setUsers] = useState<PublicProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function loadUsers() {
      setLoading(true)
      
      // Get current user (optional)
      const { data: { user } } = await supabase.auth.getUser()
      // Fetch all users (exclude current user if logged in)
      let query = supabase
        .from('public_profiles')
        .select('id, username, display_name, bio, avatar_url')
        .order('display_name', { ascending: true })
      if (user?.id) {
        query = query.neq('id', user.id)
      }
      const { data: profiles, error } = await query

      if (error) {
        console.error('Error fetching users:', error)
      } else {
        setUsers(profiles || [])
      }
      
      setLoading(false)
    }

    loadUsers()
  }, [supabase, router])

  // Filter users based on search query
  const filteredUsers = users.filter(user => {
    const query = searchQuery.toLowerCase()
    return (
      user.display_name.toLowerCase().includes(query) ||
      user.username.toLowerCase().includes(query) ||
      (user.bio && user.bio.toLowerCase().includes(query))
    )
  })

  return (
    <div className="min-h-full bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="mx-auto max-w-4xl px-4 pt-3 pb-8">
        {/* Header */}
        <div className="mb-3">
          <div className="mb-2">
            <h1 className="text-2xl font-semibold text-gray-900">Discover People</h1>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, username, or bio..."
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 pl-10 focus:outline-none focus:ring-2 focus:ring-azure shadow-sm"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-azure border-t-transparent"></div>
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredUsers.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">👥</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery ? 'No users found' : 'No other users yet'}
            </h3>
            <p className="text-gray-600">
              {searchQuery
                ? 'Try a different search term'
                : 'Be the first to invite friends to join!'}
            </p>
          </div>
        )}

        {/* Users Grid */}
        {!loading && filteredUsers.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredUsers.map((user) => (
              <div
                key={user.id}
                className="group relative bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:border-azure/30 hover:shadow-md transition-all"
              >
                {/* User Avatar & Info - Clickable to profile */}
                <button
                  onClick={() => router.push(`/profile/${user.username}`)}
                  className="flex items-start gap-4 text-left w-full hover:opacity-80 transition-opacity"
                >
                  <div className="flex-shrink-0">
                    {user.avatar_url ? (
                      <Image
                        src={user.avatar_url}
                        alt={user.display_name}
                        width={56}
                        height={56}
                        className="rounded-full object-cover"
                        style={{ width: 56, height: 56 }}
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-azure text-white font-semibold text-xl">
                        {user.display_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate group-hover:text-azure transition-colors">
                      {user.display_name}
                    </h3>
                    <p className="text-sm text-gray-500 truncate">@{user.username}</p>
                    
                  </div>
                </button>

                {/* Bio */}
                {user.bio && (
                  <p className="mt-3 text-sm text-gray-600 line-clamp-3">
                    {user.bio}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Results count */}
        {!loading && filteredUsers.length > 0 && (
          <p className="mt-6 text-center text-sm text-gray-500">
            Showing {filteredUsers.length} {filteredUsers.length === 1 ? 'person' : 'people'}
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        )}
      </div>
    </div>
  )
}
