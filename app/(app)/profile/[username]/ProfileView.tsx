'use client'

import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { PublicProfile } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { getOrCreateDirectConversation } from '@/lib/chat/conversations'
import { useState } from 'react'

interface ProfileViewProps {
  profile: PublicProfile
  isOwnProfile: boolean
}

export default function ProfileView({ profile, isOwnProfile }: ProfileViewProps) {
  const router = useRouter()
  const supabase = createClient()
  const [startingChat, setStartingChat] = useState(false)

  const handleStartChat = async () => {
    if (isOwnProfile) return

    setStartingChat(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      await getOrCreateDirectConversation(user.id, profile.id)
      router.push(`/chat/${profile.username}`)
    } catch (error) {
      console.error('Error starting conversation:', error)
    } finally {
      setStartingChat(false)
    }
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="mx-auto max-w-2xl px-4 pt-10 pb-8">
        {/* Profile Card */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {/* Cover/Banner Area */}
          <div className="h-32 bg-gradient-to-r from-azure to-azure/70" />

          {/* Profile Content */}
          <div className="px-6 pb-8">
            {/* Avatar and Right Side Content Row */}
            <div className="relative -mt-16 flex items-end justify-between">
              {/* Avatar */}
              <div className="relative">
                {profile.avatar_url ? (
                  <Image
                    src={profile.avatar_url}
                    alt={profile.display_name}
                    width={128}
                    height={128}
                    className="rounded-full border-4 border-white shadow-lg object-cover"
                    style={{ width: 128, height: 128 }}
                  />
                ) : (
                  <div className="w-32 h-32 rounded-full border-4 border-white shadow-lg bg-azure flex items-center justify-center">
                    <span className="text-4xl font-bold text-white">
                      {profile.display_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>

              {/* Right side: Action Button */}
              <div className="flex items-center gap-3 mb-2">
                {/* Action Button */}
                {isOwnProfile ? (
                  <button
                    onClick={() => router.push('/settings')}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-azure text-white rounded-xl font-medium hover:bg-azure/90 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit Profile
                  </button>
                ) : (
                  <button
                    onClick={handleStartChat}
                    disabled={startingChat}
                    className="inline-flex items-center px-6 py-2 bg-azure text-white rounded-xl font-medium hover:bg-azure/90 transition-colors disabled:opacity-50"
                  >
                    {startingChat ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span className="ml-2">Starting...</span>
                      </>
                    ) : (
                      'Chat'
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Name and Username */}
            <div className="mt-4 mb-4">
              <h1 className="text-2xl font-bold text-gray-900">{profile.display_name}</h1>
              <p className="text-gray-500">@{profile.username}</p>
            </div>

            {/* Bio */}
            {profile.bio && (
              <div>
                <p className="text-gray-700 leading-relaxed">{profile.bio}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
