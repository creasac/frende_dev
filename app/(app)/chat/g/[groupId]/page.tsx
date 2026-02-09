import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ChatInterface from '../../ChatInterface'

export default async function GroupChatPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
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

  // Verify this is a valid group conversation and user is a participant
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, is_group')
    .eq('id', groupId)
    .eq('is_group', true)
    .single()

  if (!conversation) {
    redirect('/chat')
  }

  // Check if user is a participant in this group
  const { data: participant } = await supabase
    .from('conversation_participants')
    .select('id')
    .eq('conversation_id', groupId)
    .eq('user_id', user.id)
    .single()

  if (!participant) {
    redirect('/chat')
  }

  return (
    <ChatInterface
      user={user}
      profile={profile}
      initialConversationId={groupId}
      otherUsername={null}
    />
  )
}
