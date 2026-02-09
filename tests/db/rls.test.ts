import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, createAnonClient, createUser, getSupabaseEnv, signInUser } from './supabase'

const env = getSupabaseEnv()
const suite = env ? describe : describe.skip

suite('Supabase RLS security', () => {
  let admin: SupabaseClient
  let user1Client: SupabaseClient
  let user2Client: SupabaseClient
  let user3Client: SupabaseClient
  let user1: { id: string; email: string; password: string }
  let user2: { id: string; email: string; password: string }
  let user3: { id: string; email: string; password: string }
  let conversationId: string
  let participantConversationId: string
  let messageId: string
  let bypassMessageId: string
  let processingVoiceMessageId: string
  let messageStatusId: string
  let aiSessionId: string
  let aiMessageId: string
  let avatarObjectKey: string
  let voiceConversationObjectKey: string
  let voiceMessageObjectKey: string

  beforeAll(async () => {
    if (!env) return
    admin = createAdminClient({ url: env.url, serviceRoleKey: env.serviceRoleKey })
    user1Client = createAnonClient({ url: env.url, anonKey: env.anonKey })
    user2Client = createAnonClient({ url: env.url, anonKey: env.anonKey })
    user3Client = createAnonClient({ url: env.url, anonKey: env.anonKey })

    const suffix = Date.now().toString(36)
    user1 = await createUser(admin, `user1-${suffix}@test.local`, 'password123', {
      username: `user1_${suffix}`,
      display_name: 'User One',
      language_preference: 'en',
    })
    user2 = await createUser(admin, `user2-${suffix}@test.local`, 'password123', {
      username: `user2_${suffix}`,
      display_name: 'User Two',
      language_preference: 'en',
    })
    user3 = await createUser(admin, `user3-${suffix}@test.local`, 'password123', {
      username: `user3_${suffix}`,
      display_name: 'User Three',
      language_preference: 'en',
    })

    await signInUser(user1Client, user1.email, user1.password)
    await signInUser(user2Client, user2.email, user2.password)
    await signInUser(user3Client, user3.email, user3.password)

    const { error: schemaError } = await admin
      .from('messages')
      .select('id,audio_path,processing_status,bypass_recipient_preferences')
      .limit(1)
    if (schemaError) {
      if (schemaError.message?.includes("Could not find the 'audio_path' column")) {
        throw new Error(
          "Local Supabase schema is outdated (missing messages.audio_path). Run 'npm run test:db:local' to reset local DB and apply migrations before running DB tests."
        )
      }
      if (schemaError.message?.includes("Could not find the 'bypass_recipient_preferences' column")) {
        throw new Error(
          "Local Supabase schema is outdated (missing messages.bypass_recipient_preferences). Run 'npm run test:db:local' to reset local DB and apply migrations before running DB tests."
        )
      }
      throw schemaError
    }

    const { data: conv, error: convError } = await admin
      .from('conversations')
      .insert({ is_group: false })
      .select('id')
      .single()
    if (convError || !conv) throw convError || new Error('Failed to create conversation')
    conversationId = conv.id

    const { error: partError } = await admin
      .from('conversation_participants')
      .insert([
        { conversation_id: conversationId, user_id: user1.id, is_admin: false },
        { conversation_id: conversationId, user_id: user2.id, is_admin: false },
      ])
    if (partError) throw partError

    const { data: message, error: messageError } = await user1Client
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user1.id,
        content_type: 'text',
        original_text: 'Hello there',
        original_language: 'en',
      })
      .select('id')
      .single()
    if (messageError || !message) throw messageError || new Error('Failed to create message')
    messageId = message.id

    const { data: bypassMessage, error: bypassMessageError } = await user1Client
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user1.id,
        content_type: 'text',
        original_text: 'As-is message',
        original_language: 'en',
        bypass_recipient_preferences: true,
      })
      .select('id')
      .single()
    if (bypassMessageError || !bypassMessage) {
      throw bypassMessageError || new Error('Failed to create bypass message')
    }
    bypassMessageId = bypassMessage.id

    const { data: processingVoiceMessage, error: processingVoiceMessageError } = await user1Client
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user1.id,
        content_type: 'text',
        audio_path: `${user1.id}/${conversationId}/pending.webm`,
        processing_status: 'processing',
      })
      .select('id')
      .single()
    if (processingVoiceMessageError || !processingVoiceMessage) {
      throw processingVoiceMessageError || new Error('Failed to create processing voice message')
    }
    processingVoiceMessageId = processingVoiceMessage.id

    await admin.from('message_translations').insert({
      message_id: messageId,
      target_language: 'es',
      translated_text: 'Hola',
    })

    await admin.from('message_scaled_texts').insert({
      message_id: messageId,
      target_language: 'en',
      target_proficiency: 'beginner',
      scaled_text: 'Hello.',
    })

    await admin.from('message_corrections').insert({
      message_id: messageId,
      user_id: user1.id,
      feedback_language: 'en',
      original_text: 'Hello there',
      corrected_sentence: 'Hello there.',
      overall_score: 92,
      has_issues: true,
      issues: [
        {
          type: 'punctuation',
          original: 'Hello there',
          correction: 'Hello there.',
          explanation: 'Add a period at the end of the sentence.',
          position: 'end of sentence',
        },
      ],
      word_suggestions: [],
      praise: 'Great start.',
      tip: 'End complete sentences with punctuation.',
    })

    await admin.from('message_voice_renderings').insert([
      {
        message_id: messageId,
        user_id: user1.id,
        source_language: 'en',
        target_language: 'en',
        target_proficiency: null,
        needs_translation: false,
        needs_scaling: false,
        transcript_text: 'Hello there',
        translated_text: null,
        scaled_text: null,
        final_text: 'Hello there',
        final_language: 'en',
        final_audio_path: `${user1.id}/${messageId}/tts.mp3`,
        processing_status: 'ready',
      },
      {
        message_id: messageId,
        user_id: user2.id,
        source_language: 'en',
        target_language: 'en',
        target_proficiency: null,
        needs_translation: false,
        needs_scaling: false,
        transcript_text: 'Hello there',
        translated_text: null,
        scaled_text: null,
        final_text: 'Hello there',
        final_language: 'en',
        final_audio_path: `${user2.id}/${messageId}/tts.mp3`,
        processing_status: 'ready',
      },
    ])

    const { data: conv2, error: conv2Error } = await admin
      .from('conversations')
      .insert({ is_group: true, group_name: 'Test Group' })
      .select('id')
      .single()
    if (conv2Error || !conv2) throw conv2Error || new Error('Failed to create group conversation')
    participantConversationId = conv2.id

    const { error: part2Error } = await admin
      .from('conversation_participants')
      .insert([
        { conversation_id: participantConversationId, user_id: user1.id, is_admin: true },
        { conversation_id: participantConversationId, user_id: user2.id, is_admin: false },
      ])
    if (part2Error) throw part2Error

    const { data: aiSession, error: aiSessionError } = await user1Client
      .from('ai_chat_sessions')
      .insert({
        user_id: user1.id,
        name: 'Test Session',
        response_language: 'en',
      })
      .select('id')
      .single()
    if (aiSessionError || !aiSession) throw aiSessionError || new Error('Failed to create AI session')
    aiSessionId = aiSession.id

    const { data: aiMessage, error: aiMessageError } = await user1Client
      .from('ai_chat_messages')
      .insert({
        session_id: aiSessionId,
        role: 'user',
        content: 'Hello AI',
      })
      .select('id')
      .single()
    if (aiMessageError || !aiMessage) throw aiMessageError || new Error('Failed to create AI message')
    aiMessageId = aiMessage.id

    await admin.from('ai_chat_message_corrections').insert({
      ai_message_id: aiMessageId,
      user_id: user1.id,
      feedback_language: 'en',
      original_text: 'Hello AI',
      corrected_sentence: 'Hello, AI.',
      overall_score: 88,
      has_issues: true,
      issues: [
        {
          type: 'punctuation',
          original: 'Hello AI',
          correction: 'Hello, AI.',
          explanation: 'Use a comma for direct address.',
          position: 'middle of sentence',
        },
      ],
      word_suggestions: [],
      praise: 'Friendly message.',
      tip: 'Use punctuation for names and direct address.',
    })

    const { error: bucketError } = await admin.storage.createBucket('avatars', {
      public: true,
    })
    if (bucketError && !bucketError.message?.toLowerCase().includes('exist')) {
      throw bucketError
    }

    const { error: voiceBucketError } = await admin.storage.createBucket('voice-messages', {
      public: false,
    })
    if (voiceBucketError && !voiceBucketError.message?.toLowerCase().includes('exist')) {
      throw voiceBucketError
    }

    avatarObjectKey = `${user1.id}/avatar.txt`
    const { error: uploadError } = await user1Client.storage
      .from('avatars')
      .upload(avatarObjectKey, new Blob(['avatar'], { type: 'text/plain' }), {
        upsert: true,
        contentType: 'text/plain',
      })
    if (uploadError) throw uploadError

    voiceConversationObjectKey = `${user1.id}/${conversationId}/voice-original-test.webm`
    const { error: voiceConversationUploadError } = await user1Client.storage
      .from('voice-messages')
      .upload(voiceConversationObjectKey, new Blob(['voice-original'], { type: 'audio/webm' }), {
        upsert: true,
        contentType: 'audio/webm',
      })
    if (voiceConversationUploadError) throw voiceConversationUploadError

    voiceMessageObjectKey = `${user1.id}/${messageId}/voice-final-test.mp3`
    const { error: voiceMessageUploadError } = await user1Client.storage
      .from('voice-messages')
      .upload(voiceMessageObjectKey, new Blob(['voice-final'], { type: 'audio/mpeg' }), {
        upsert: true,
        contentType: 'audio/mpeg',
      })
    if (voiceMessageUploadError) throw voiceMessageUploadError
  })

  afterAll(async () => {
    if (!env || !admin || !user1 || !user2 || !user3) return
    const voiceKeys = [voiceConversationObjectKey, voiceMessageObjectKey].filter(Boolean)
    if (voiceKeys.length > 0) {
      await admin.storage.from('voice-messages').remove(voiceKeys)
    }
    if (avatarObjectKey) {
      await admin.storage.from('avatars').remove([avatarObjectKey])
    }
    if (aiMessageId) {
      await admin.from('ai_chat_message_corrections').delete().eq('ai_message_id', aiMessageId)
      await admin.from('ai_chat_messages').delete().eq('id', aiMessageId)
    }
    if (aiSessionId) {
      await admin.from('ai_chat_sessions').delete().eq('id', aiSessionId)
    }
    await admin.from('message_status').delete().eq('message_id', messageId)
    await admin.from('message_corrections').delete().eq('message_id', messageId)
    await admin.from('message_voice_renderings').delete().eq('message_id', messageId)
    await admin.from('message_scaled_texts').delete().eq('message_id', messageId)
    await admin.from('message_translations').delete().eq('message_id', messageId)
    await admin.from('messages').delete().eq('conversation_id', conversationId)
    if (participantConversationId) {
      await admin.from('conversation_participants').delete().eq('conversation_id', participantConversationId)
      await admin.from('conversations').delete().eq('id', participantConversationId)
    }
    await admin.from('conversation_participants').delete().eq('conversation_id', conversationId)
    await admin.from('conversations').delete().eq('id', conversationId)
    await admin.from('profiles').delete().in('id', [user1.id, user2.id, user3.id])
    await admin.auth.admin.deleteUser(user1.id)
    await admin.auth.admin.deleteUser(user2.id)
    await admin.auth.admin.deleteUser(user3.id)
  })

  it('exposes limited public profile fields while keeping full profile rows self-only', async () => {
    const { data: publicProfiles, error: publicProfilesError } = await createAnonClient({
      url: env!.url,
      anonKey: env!.anonKey,
    })
      .from('public_profiles')
      .select('id, username, display_name, bio, avatar_url')
      .in('id', [user1.id, user2.id])

    expect(publicProfilesError).toBeNull()
    expect(publicProfiles?.length ?? 0).toBe(2)

    const { data: hiddenProfiles, error: hiddenProfilesError } = await user3Client
      .from('profiles')
      .select('id')
      .eq('id', user1.id)

    expect(hiddenProfilesError).toBeNull()
    expect(hiddenProfiles?.length ?? 0).toBe(0)

    const { data: ownProfile, error: ownProfileError } = await user3Client
      .from('profiles')
      .select('id, language_preference, auto_correction_enabled')
      .eq('id', user3.id)
      .single()

    expect(ownProfileError).toBeNull()
    expect(ownProfile?.id).toBe(user3.id)
    expect(ownProfile?.language_preference).toBe('en')
    expect(ownProfile?.auto_correction_enabled).toBe(true)

    const { data: updated, error } = await user2Client
      .from('profiles')
      .update({ display_name: 'Hacked' })
      .eq('id', user1.id)
      .select('id')
    expect(error).toBeNull()
    expect(updated?.length ?? 0).toBe(0)
  })

  it('restricts conversations to participants', async () => {
    const { data: user1Convs } = await user1Client
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
    expect(user1Convs?.length).toBe(1)

    const { data: user3Convs } = await user3Client
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
    expect(user3Convs?.length).toBe(0)
  })

  it('restricts messages to participants', async () => {
    const { data: user2Messages } = await user2Client
      .from('messages')
      .select('id,bypass_recipient_preferences')
      .eq('id', messageId)
    expect(user2Messages?.length).toBe(1)
    expect(user2Messages?.[0]?.bypass_recipient_preferences).toBeFalsy()

    const { data: user3Messages } = await user3Client
      .from('messages')
      .select('id')
      .eq('id', messageId)
    expect(user3Messages?.length).toBe(0)

    const { data: user2BypassMessages } = await user2Client
      .from('messages')
      .select('id,bypass_recipient_preferences')
      .eq('id', bypassMessageId)
    expect(user2BypassMessages?.length).toBe(1)
    expect(user2BypassMessages?.[0]?.bypass_recipient_preferences).toBe(true)

    const { data: user3BypassMessages } = await user3Client
      .from('messages')
      .select('id')
      .eq('id', bypassMessageId)
    expect(user3BypassMessages?.length).toBe(0)
  })

  it('shows processing voice messages to conversation participants', async () => {
    const { data: senderView } = await user1Client
      .from('messages')
      .select('id')
      .eq('id', processingVoiceMessageId)
    expect(senderView?.length).toBe(1)

    const { data: receiverView } = await user2Client
      .from('messages')
      .select('id')
      .eq('id', processingVoiceMessageId)
    expect(receiverView?.length ?? 0).toBe(1)
  })

  it('restricts message translations and scaled texts to participants', async () => {
    const { data: user2Translations } = await user2Client
      .from('message_translations')
      .select('message_id')
      .eq('message_id', messageId)
    expect(user2Translations?.length).toBe(1)

    const { data: user3Translations } = await user3Client
      .from('message_translations')
      .select('message_id')
      .eq('message_id', messageId)
    expect(user3Translations?.length).toBe(0)

    const { data: user2Scaled } = await user2Client
      .from('message_scaled_texts')
      .select('message_id')
      .eq('message_id', messageId)
    expect(user2Scaled?.length).toBe(1)

    const { data: user3Scaled } = await user3Client
      .from('message_scaled_texts')
      .select('message_id')
      .eq('message_id', messageId)
    expect(user3Scaled?.length).toBe(0)

    const { error: participantInsertTranslationError } = await user2Client
      .from('message_translations')
      .insert({
        message_id: messageId,
        target_language: 'fr',
        translated_text: 'Bonjour',
      })
    expect(participantInsertTranslationError).toBeNull()

    const { error: outsiderInsertTranslationError } = await user3Client
      .from('message_translations')
      .insert({
        message_id: messageId,
        target_language: 'de',
        translated_text: 'Hallo',
      })
    expect(outsiderInsertTranslationError).toBeTruthy()

    const { error: participantInsertScaledError } = await user2Client
      .from('message_scaled_texts')
      .insert({
        message_id: messageId,
        target_language: 'en',
        target_proficiency: 'advanced',
        scaled_text: 'Hello there, and welcome.',
      })
    expect(participantInsertScaledError).toBeNull()

    const { error: outsiderInsertScaledError } = await user3Client
      .from('message_scaled_texts')
      .insert({
        message_id: messageId,
        target_language: 'en',
        target_proficiency: 'intermediate',
        scaled_text: 'Hello there.',
      })
    expect(outsiderInsertScaledError).toBeTruthy()

    const { error: bypassTranslationInsertError } = await user2Client
      .from('message_translations')
      .insert({
        message_id: bypassMessageId,
        target_language: 'es',
        translated_text: 'Mensaje sin cambios',
      })
    expect(bypassTranslationInsertError).toBeTruthy()

    const { error: bypassScaledInsertError } = await user2Client
      .from('message_scaled_texts')
      .insert({
        message_id: bypassMessageId,
        target_language: 'en',
        target_proficiency: 'advanced',
        scaled_text: 'As-is message.',
      })
    expect(bypassScaledInsertError).toBeTruthy()

    const { data: user1VoiceRendering } = await user1Client
      .from('message_voice_renderings')
      .select('message_id, user_id')
      .eq('message_id', messageId)
      .eq('user_id', user1.id)
    expect(user1VoiceRendering?.length).toBe(1)

    const { data: user2VoiceRenderingAsUser1 } = await user1Client
      .from('message_voice_renderings')
      .select('message_id, user_id')
      .eq('message_id', messageId)
      .eq('user_id', user2.id)
    expect(user2VoiceRenderingAsUser1?.length).toBe(0)

    const { data: user3VoiceRendering } = await user3Client
      .from('message_voice_renderings')
      .select('message_id')
      .eq('message_id', messageId)
    expect(user3VoiceRendering?.length).toBe(0)

    const { error: senderUpsertRecipientVoiceRenderingError } = await user1Client
      .from('message_voice_renderings')
      .upsert(
        {
          message_id: bypassMessageId,
          user_id: user2.id,
          source_language: null,
          target_language: 'und',
          target_proficiency: null,
          needs_translation: false,
          needs_scaling: false,
          transcript_text: '',
          translated_text: null,
          scaled_text: null,
          final_text: '',
          final_language: 'und',
          final_audio_path: `${user1.id}/${bypassMessageId}/as-is.mp3`,
          processing_status: 'ready',
        },
        { onConflict: 'message_id,user_id' }
      )
    expect(senderUpsertRecipientVoiceRenderingError).toBeNull()

    const { error: senderUpsertRecipientVoiceRenderingAgainError } = await user1Client
      .from('message_voice_renderings')
      .upsert(
        {
          message_id: bypassMessageId,
          user_id: user2.id,
          source_language: null,
          target_language: 'und',
          target_proficiency: null,
          needs_translation: false,
          needs_scaling: false,
          transcript_text: '',
          translated_text: null,
          scaled_text: null,
          final_text: '',
          final_language: 'und',
          final_audio_path: `${user1.id}/${bypassMessageId}/as-is-2.mp3`,
          processing_status: 'ready',
        },
        { onConflict: 'message_id,user_id' }
      )
    expect(senderUpsertRecipientVoiceRenderingAgainError).toBeNull()

    const { error: senderInsertOutsiderVoiceRenderingError } = await user1Client
      .from('message_voice_renderings')
      .insert({
        message_id: bypassMessageId,
        user_id: user3.id,
        source_language: null,
        target_language: 'und',
        target_proficiency: null,
        needs_translation: false,
        needs_scaling: false,
        transcript_text: '',
        translated_text: null,
        scaled_text: null,
        final_text: '',
        final_language: 'und',
        final_audio_path: `${user1.id}/${bypassMessageId}/blocked.mp3`,
        processing_status: 'ready',
      })
    expect(senderInsertOutsiderVoiceRenderingError).toBeTruthy()

    const { error: nonSenderInsertVoiceRenderingError } = await user2Client
      .from('message_voice_renderings')
      .insert({
        message_id: bypassMessageId,
        user_id: user1.id,
        source_language: null,
        target_language: 'und',
        target_proficiency: null,
        needs_translation: false,
        needs_scaling: false,
        transcript_text: '',
        translated_text: null,
        scaled_text: null,
        final_text: '',
        final_language: 'und',
        final_audio_path: `${user2.id}/${bypassMessageId}/blocked-nonsender.mp3`,
        processing_status: 'ready',
      })
    expect(nonSenderInsertVoiceRenderingError).toBeTruthy()
  })

  it('restricts message corrections to the sender', async () => {
    const { data: senderCorrections } = await user1Client
      .from('message_corrections')
      .select('message_id, user_id, corrected_sentence')
      .eq('message_id', messageId)
      .eq('user_id', user1.id)
    expect(senderCorrections?.length ?? 0).toBe(1)

    const { data: participantCorrections } = await user2Client
      .from('message_corrections')
      .select('message_id')
      .eq('message_id', messageId)
    expect(participantCorrections?.length ?? 0).toBe(0)

    const { data: outsiderCorrections } = await user3Client
      .from('message_corrections')
      .select('message_id')
      .eq('message_id', messageId)
    expect(outsiderCorrections?.length ?? 0).toBe(0)

    const { error: senderUpsertError } = await user1Client
      .from('message_corrections')
      .upsert(
        {
          message_id: messageId,
          user_id: user1.id,
          feedback_language: 'en',
          original_text: 'Hello there',
          corrected_sentence: 'Hello there.',
          overall_score: 95,
          has_issues: true,
          issues: [],
          word_suggestions: [],
        },
        { onConflict: 'message_id,user_id' }
      )
    expect(senderUpsertError).toBeNull()

    const { error: participantInsertError } = await user2Client
      .from('message_corrections')
      .insert({
        message_id: messageId,
        user_id: user2.id,
        feedback_language: 'en',
        original_text: 'Hello there',
        corrected_sentence: 'Hello there.',
        overall_score: 95,
        has_issues: false,
        issues: [],
        word_suggestions: [],
      })
    expect(participantInsertError).toBeTruthy()
  })

  it('secures get_conversation_participants_secure RPC', async () => {
    const { data: user1Participants } = await user1Client
      .rpc('get_conversation_participants_secure', { conv_id: conversationId })
    expect(user1Participants?.length).toBe(2)

    const { data: user3Participants } = await user3Client
      .rpc('get_conversation_participants_secure', { conv_id: conversationId })
    expect(user3Participants?.length).toBe(0)
  })

  it('secures get_conversation_participant_preferences_secure RPC', async () => {
    const { data: user1Preferences } = await user1Client
      .rpc('get_conversation_participant_preferences_secure', { conv_id: conversationId })
    expect(user1Preferences?.length).toBe(2)

    const { data: user3Preferences } = await user3Client
      .rpc('get_conversation_participant_preferences_secure', { conv_id: conversationId })
    expect(user3Preferences?.length).toBe(0)
  })

  it('restricts conversation participant inserts to bootstrap/admin flows', async () => {
    const { error: blockedSelfJoinError } = await user3Client
      .from('conversation_participants')
      .insert({
        conversation_id: conversationId,
        user_id: user3.id,
        is_admin: false,
      })
    expect(blockedSelfJoinError).toBeTruthy()

    const { error: blockedDirectAddError } = await user1Client
      .from('conversation_participants')
      .insert({
        conversation_id: conversationId,
        user_id: user3.id,
        is_admin: false,
      })
    expect(blockedDirectAddError).toBeTruthy()

    const { error: blockedGroupAddByNonAdminError } = await user2Client
      .from('conversation_participants')
      .insert({
        conversation_id: participantConversationId,
        user_id: user3.id,
        is_admin: false,
      })
    expect(blockedGroupAddByNonAdminError).toBeTruthy()

    const { error: groupAdminAddError } = await user1Client
      .from('conversation_participants')
      .insert({
        conversation_id: participantConversationId,
        user_id: user3.id,
        is_admin: false,
      })
    expect(groupAdminAddError).toBeNull()
  })

  it('restricts conversation participant visibility and deletion', async () => {
    const { data: user3Participants } = await user3Client
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
    expect(user3Participants?.length ?? 0).toBe(0)

    const { data: deletedByUser2, error: deleteError2 } = await user2Client
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', participantConversationId)
      .eq('user_id', user1.id)
      .select('id')
    expect(deleteError2).toBeNull()
    expect(deletedByUser2?.length ?? 0).toBe(0)
    const { data: user1MembershipAfterUser2DeleteAttempt, error: user1MembershipCheckError } = await admin
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', participantConversationId)
      .eq('user_id', user1.id)
      .maybeSingle()
    expect(user1MembershipCheckError).toBeNull()
    expect(user1MembershipAfterUser2DeleteAttempt).toBeTruthy()

    const { error: deleteError1 } = await user1Client
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', participantConversationId)
      .eq('user_id', user2.id)
    expect(deleteError1).toBeNull()
    const { data: user2MembershipAfterUser1DeleteAttempt, error: user2MembershipAfterUser1DeleteAttemptError } = await admin
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', participantConversationId)
      .eq('user_id', user2.id)
      .maybeSingle()
    expect(user2MembershipAfterUser1DeleteAttemptError).toBeNull()
    expect(user2MembershipAfterUser1DeleteAttempt).toBeTruthy()

    const { error: deleteOwnParticipationError } = await user2Client
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', participantConversationId)
      .eq('user_id', user2.id)
    expect(deleteOwnParticipationError).toBeNull()
    const { data: user2MembershipAfterSelfDelete, error: user2MembershipAfterSelfDeleteError } = await admin
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', participantConversationId)
      .eq('user_id', user2.id)
      .maybeSingle()
    expect(user2MembershipAfterSelfDeleteError).toBeNull()
    expect(user2MembershipAfterSelfDelete).toBeNull()
  })

  it('allows participants to insert message status but blocks others', async () => {
    const { data: participantCheck, error: participantError } = await user2Client.rpc(
      'is_message_participant',
      { p_message_id: messageId }
    )
    expect(participantError).toBeNull()
    expect(participantCheck).toBe(true)

    const { error: statusError } = await user2Client
      .from('message_status')
      .insert({
        message_id: messageId,
        user_id: user2.id,
        status: 'delivered',
      })
    expect(statusError).toBeNull()

    const { error: blockedError } = await user3Client
      .from('message_status')
      .insert({
        message_id: messageId,
        user_id: user3.id,
        status: 'delivered',
      })
    expect(blockedError).toBeTruthy()

    const { data: senderView } = await user1Client
      .from('message_status')
      .select('id')
      .eq('message_id', messageId)
      .eq('user_id', user2.id)
      .single()
    expect(senderView).toBeTruthy()
    const { data: adminStatus } = await admin
      .from('message_status')
      .select('id, user_id, status')
      .eq('message_id', messageId)
      .eq('user_id', user2.id)
      .single()
    expect(adminStatus?.user_id).toBe(user2.id)
    expect(adminStatus?.status).toBe('delivered')
    messageStatusId = adminStatus!.id
  })

  it('restricts message status access', async () => {
    expect(messageStatusId).toBeTruthy()
    const { data: senderStatuses } = await user1Client
      .from('message_status')
      .select('id')
      .eq('message_id', messageId)
    expect(senderStatuses?.length ?? 0).toBe(1)

    const { data: user3Statuses } = await user3Client
      .from('message_status')
      .select('id')
      .eq('message_id', messageId)
    expect(user3Statuses?.length ?? 0).toBe(0)

    const { error: updateOwnerError } = await user2Client
      .from('message_status')
      .update({ status: 'read' })
      .eq('id', messageStatusId)
    expect(updateOwnerError).toBeNull()

    const { data: senderUpdated } = await user1Client
      .from('message_status')
      .select('status')
      .eq('id', messageStatusId)
      .single()
    const { data: adminUpdated } = await admin
      .from('message_status')
      .select('status')
      .eq('id', messageStatusId)
      .single()
    expect(adminUpdated?.status).toBe('read')
    expect(senderUpdated?.status).toBe('read')

    const { data: updatedByOther, error: updateOtherError } = await user3Client
      .from('message_status')
      .update({ status: 'read' })
      .eq('id', messageStatusId)
      .select('id')
    expect(updateOtherError).toBeNull()
    expect(updatedByOther?.length ?? 0).toBe(0)
  })

  it('restricts AI chat sessions and messages to owner', async () => {
    const { data: user1Sessions } = await user1Client
      .from('ai_chat_sessions')
      .select('id')
      .eq('id', aiSessionId)
    expect(user1Sessions?.length ?? 0).toBe(1)

    const { data: user2Sessions } = await user2Client
      .from('ai_chat_sessions')
      .select('id')
      .eq('id', aiSessionId)
    expect(user2Sessions?.length ?? 0).toBe(0)

    const { data: user2Insert, error: user2InsertError } = await user2Client
      .from('ai_chat_messages')
      .insert({ session_id: aiSessionId, role: 'user', content: 'Nope' })
      .select('id')
    expect(user2InsertError).toBeTruthy()
    expect(user2Insert?.length ?? 0).toBe(0)

    const { data: user2Messages } = await user2Client
      .from('ai_chat_messages')
      .select('id')
      .eq('id', aiMessageId)
    expect(user2Messages?.length ?? 0).toBe(0)
  })

  it('restricts AI chat message corrections to the owner', async () => {
    const { data: ownerRows } = await user1Client
      .from('ai_chat_message_corrections')
      .select('ai_message_id, user_id')
      .eq('ai_message_id', aiMessageId)
      .eq('user_id', user1.id)
    expect(ownerRows?.length ?? 0).toBe(1)

    const { data: user2Rows } = await user2Client
      .from('ai_chat_message_corrections')
      .select('ai_message_id')
      .eq('ai_message_id', aiMessageId)
    expect(user2Rows?.length ?? 0).toBe(0)

    const { error: ownerUpsertError } = await user1Client
      .from('ai_chat_message_corrections')
      .upsert(
        {
          ai_message_id: aiMessageId,
          user_id: user1.id,
          feedback_language: 'en',
          original_text: 'Hello AI',
          corrected_sentence: 'Hello, AI.',
          overall_score: 90,
          has_issues: true,
          issues: [],
          word_suggestions: [],
        },
        { onConflict: 'ai_message_id,user_id' }
      )
    expect(ownerUpsertError).toBeNull()

    const { error: user2InsertError } = await user2Client
      .from('ai_chat_message_corrections')
      .insert({
        ai_message_id: aiMessageId,
        user_id: user2.id,
        feedback_language: 'en',
        original_text: 'Hello AI',
        corrected_sentence: 'Hello, AI.',
        overall_score: 90,
        has_issues: true,
        issues: [],
        word_suggestions: [],
      })
    expect(user2InsertError).toBeTruthy()
  })

  it('enforces voice-messages storage owner upload and participant-only reads', async () => {
    const { data: participantConversationDownload, error: participantConversationError } = await user2Client.storage
      .from('voice-messages')
      .download(voiceConversationObjectKey)
    expect(participantConversationError).toBeNull()
    expect(participantConversationDownload).toBeTruthy()

    const { data: participantMessageDownload, error: participantMessageError } = await user2Client.storage
      .from('voice-messages')
      .download(voiceMessageObjectKey)
    expect(participantMessageError).toBeNull()
    expect(participantMessageDownload).toBeTruthy()

    const { data: outsiderDownload, error: outsiderDownloadError } = await user3Client.storage
      .from('voice-messages')
      .download(voiceConversationObjectKey)
    expect(outsiderDownloadError).toBeTruthy()
    expect(outsiderDownload).toBeNull()

    const { error: forgedUploadError } = await user2Client.storage
      .from('voice-messages')
      .upload(
        `${user1.id}/${conversationId}/forged-upload.webm`,
        new Blob(['forged'], { type: 'audio/webm' }),
        { upsert: true, contentType: 'audio/webm' }
      )
    expect(forgedUploadError).toBeTruthy()
  })

  it('enforces storage ownership for avatars', async () => {
    const { data: publicDownload, error: publicError } = await createAnonClient({
      url: env!.url,
      anonKey: env!.anonKey,
    }).storage.from('avatars').download(avatarObjectKey)
    expect(publicError).toBeNull()
    expect(publicDownload).toBeTruthy()

    const { data: removedByOther } = await user2Client.storage
      .from('avatars')
      .remove([avatarObjectKey])
    expect(removedByOther ?? []).toHaveLength(0)

    const { data: removedByOwner, error: removeOwnerError } = await user1Client.storage
      .from('avatars')
      .remove([avatarObjectKey])
    expect(removeOwnerError).toBeNull()
    expect(removedByOwner ?? []).toHaveLength(1)
  })
})
