import { useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RealtimeChannel } from '@supabase/supabase-js'

type PresencePayload = { username: string; presence_ref: string }[]

export function usePresence(userId: string, username: string) {
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let presenceChannel: RealtimeChannel

    async function init() {
      // Update last_seen immediately
      await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', userId)

      // Join presence channel with user info
      presenceChannel = supabase.channel('room1')

      await presenceChannel
        .on('presence', { event: 'sync' }, () => {
          console.log('[usePresence] Synced')
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }: { key: string; newPresences: PresencePayload }) => {
          console.log('[usePresence] Join:', key, newPresences)
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }: { key: string; leftPresences: PresencePayload }) => {
          console.log('[usePresence] Leave:', key, leftPresences)
        })
        .subscribe(async (status: string) => {
          console.log('[usePresence] Status:', status)
          if (status === 'SUBSCRIBED') {
            await presenceChannel.track({
              user_id: userId,
              username: username,
              online_at: new Date().toISOString(),
            })
          }
        })
    }

    init()

    // Update last_seen every 15 seconds
    const interval = setInterval(async () => {
      await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', userId)
    }, 15000)

    return () => {
      if (presenceChannel) {
        presenceChannel.untrack()
        supabase.removeChannel(presenceChannel)
      }
      clearInterval(interval)
    }
  }, [supabase, userId, username])
}
