import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ChatInterface from '../ChatInterface'

export default async function ChatWithUserPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const supabase = await createClient()
  
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }

  // Find the other user by username
  const { data: otherUser } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, bio, avatar_url')
    .eq('username', username)
    .single()

  if (!otherUser) {
    redirect('/chat')
  }

  // Find existing conversation between these two users
  const { data: existingConvs } = await supabase
    .from('conversation_participants')
    .select('conversation_id, conversations!inner(is_group)')
    .eq('user_id', user.id)

  let conversationId: string | null = null

  if (existingConvs) {
    for (const conv of existingConvs) {
      const convData = conv.conversations as unknown as { is_group: boolean }
      if (!convData.is_group) {
        // Check if other user is in this conversation using secure function
        const { data: participants } = await supabase
          .rpc('get_conversation_participants_secure', { conv_id: conv.conversation_id })

        if (participants && participants.some((p: { user_id: string }) => p.user_id === otherUser.id)) {
          conversationId = conv.conversation_id
          break
        }
      }
    }
  }

  return (
    <ChatInterface
      user={user}
      profile={profile}
      initialConversationId={conversationId}
      otherUsername={username}
    />
  )
}
