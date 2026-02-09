import { createClient } from '@/lib/supabase/client'

export async function getOrCreateDirectConversation(
  userId1: string,
  userId2: string
): Promise<string> {
  const supabase = createClient()

  // Find existing 1-to-1 conversation between these two users with a single query
  // This uses a subquery approach to avoid N+1 queries
  const { data: existingConversation } = await supabase
    .from('conversation_participants')
    .select(`
      conversation_id,
      conversations!inner(id, is_group)
    `)
    .eq('user_id', userId1)
    .eq('conversations.is_group', false)

  if (existingConversation && existingConversation.length > 0) {
    // Get all conversation IDs where user1 is a participant
    const conversationIds = existingConversation.map(c => c.conversation_id)
    
    // Check which of these conversations also have user2 using secure function
    for (const convId of conversationIds) {
      const { data: participants } = await supabase
        .rpc('get_conversation_participants_secure', { conv_id: convId })
      
      if (participants && participants.some((p: { user_id: string }) => p.user_id === userId2)) {
        // Clear hidden_at for user1 so the conversation appears in their list again
        await supabase
          .from('conversation_participants')
          .update({ hidden_at: null })
          .eq('conversation_id', convId)
          .eq('user_id', userId1)
        
        return convId
      }
    }
  }

  // No existing conversation found, create new one
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .insert({
      is_group: false,
    })
    .select()
    .single()

  if (convError) throw convError

  // Insert creator first, then recipient.
  const { error: selfPartError } = await supabase
    .from('conversation_participants')
    .insert({
      conversation_id: conversation.id,
      user_id: userId1,
      is_admin: false,
    })

  if (selfPartError) throw selfPartError

  const { error: otherPartError } = await supabase
    .from('conversation_participants')
    .insert({
      conversation_id: conversation.id,
      user_id: userId2,
      is_admin: false,
    })

  if (otherPartError) throw otherPartError

  return conversation.id
}

export async function createConversation(
  participantIds: string[],
  isGroup: boolean = false,
  groupName?: string
) {
  const supabase = createClient()
  const uniqueParticipantIds = Array.from(new Set(participantIds))
  if (uniqueParticipantIds.length === 0) {
    throw new Error('At least one participant is required')
  }
  const creatorId = uniqueParticipantIds[0]

  // Create conversation
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .insert({
      is_group: isGroup,
      group_name: groupName,
    })
    .select()
    .single()

  if (convError) throw convError

  // Insert creator first. Group creators become admin.
  const { error: creatorPartError } = await supabase
    .from('conversation_participants')
    .insert({
      conversation_id: conversation.id,
      user_id: creatorId,
      is_admin: isGroup,
    })

  if (creatorPartError) throw creatorPartError

  const otherParticipants = uniqueParticipantIds.slice(1).map((userId) => ({
    conversation_id: conversation.id,
    user_id: userId,
    is_admin: false,
  }))

  if (otherParticipants.length > 0) {
    const { error: partError } = await supabase
      .from('conversation_participants')
      .insert(otherParticipants)
    if (partError) throw partError
  }

  return conversation
}

export async function getUserConversations(userId: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('conversation_participants')
    .select(`
      conversation_id,
      conversations (
        id,
        is_group,
        group_name,
        group_avatar_url,
        updated_at
      )
    `)
    .eq('user_id', userId)
    .order('conversations(updated_at)', { ascending: false })

  if (error) throw error
  return data
}

export async function getConversationParticipants(conversationId: string) {
  const supabase = createClient()

  // Use secure function to get participants (validates caller is a member)
  const { data: participants, error: partError } = await supabase
    .rpc('get_conversation_participants_secure', { conv_id: conversationId })

  if (partError) throw partError
  if (!participants || participants.length === 0) return []

  // Get profile details for each participant
  const userIds = participants.map((p: { user_id: string }) => p.user_id)
  
  const { data: profiles, error: profileError } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', userIds)

  if (profileError) throw profileError

  // Combine participant data with profile data
  return participants.map((p: { user_id: string }) => ({
    user_id: p.user_id,
    profiles: profiles?.find(profile => profile.id === p.user_id) || null
  }))
}

export async function unhideConversationForUser(conversationId: string, userId: string) {
  const supabase = createClient()

  // Clear hidden_at to make conversation visible again
  const { error } = await supabase
    .from('conversation_participants')
    .update({ hidden_at: null })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)

  if (error) {
    console.error('Error unhiding conversation:', error)
  }
}

export async function deleteConversationForUser(conversationId: string, userId: string) {
  const supabase = createClient()

  // Soft delete: set hidden_at timestamp instead of removing the user
  // This allows the conversation to reappear if they receive new messages
  const { error } = await supabase
    .from('conversation_participants')
    .update({ hidden_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)

  if (error) throw error
}

export async function clearChatHistoryForUser(conversationId: string, userId: string) {
  const supabase = createClient()

  // Set cleared_at to current timestamp
  // Messages before this time will not be shown to this user
  const { error } = await supabase
    .from('conversation_participants')
    .update({ cleared_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)

  if (error) throw error
}

export async function getClearedAtForUser(conversationId: string, userId: string): Promise<string | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('conversation_participants')
    .select('cleared_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .single()

  if (error || !data) return null
  return data.cleared_at
}
