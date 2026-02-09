import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type PresenceState = { username: string; presence_ref: string }[]

export function useUserPresence(username: string) {
  const [isOnline, setIsOnline] = useState(false)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!username) {
      setTimeout(() => {
        setIsOnline(false)
        setLastSeen(null)
      }, 0)
      return
    }

    // Subscribe to shared presence channel. Do not read other users' private profile fields.
    const presenceChannel = supabase.channel('room1')
    const syncPresenceState = () => {
      const state = presenceChannel.presenceState()
      let found = false
      Object.values(state).forEach((presences) => {
        (presences as PresenceState).forEach((presence) => {
          if (presence.username === username) {
            found = true
          }
        })
      })

      setIsOnline((wasOnline) => {
        if (wasOnline && !found) {
          setLastSeen(new Date().toISOString())
        }
        return found
      })
    }

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        syncPresenceState()
      })
      .on('presence', { event: 'join' }, ({ newPresences }: { newPresences: PresenceState }) => {
        newPresences.forEach((presence) => {
          if (presence.username === username) {
            setIsOnline(true)
          }
        })
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }: { leftPresences: PresenceState }) => {
        let targetLeft = false
        leftPresences.forEach((presence) => {
          if (presence.username === username) {
            targetLeft = true
          }
        })
        if (targetLeft) {
          syncPresenceState()
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(presenceChannel)
    }
  }, [supabase, username])

  return { isOnline, lastSeen }
}
