-- ============================================
-- FRENDE RLS (Row Level Security) POLICIES
-- ============================================
-- Last Updated: 2026-01-02
--
-- This file contains all RLS policies for the Frende chat application.
-- Run this entire file in Supabase SQL Editor to reset/update policies.
--
-- SECURITY SUMMARY:
-- ┌─────────────────────────┬─────────────────┬────────────────────┬─────────────────┐
-- │ Table                   │ Insert          │ Select             │ Update          │
-- ├─────────────────────────┼─────────────────┼────────────────────┼─────────────────┤
-- │ profiles                │ Own only        │ Public (discovery) │ Own only        │
-- │ conversations           │ Authenticated   │ Participants only  │ Participants    │
-- │ conversation_participants│ Authenticated   │ Own records ONLY   │ Own only        │
-- │ messages                │ Own + in convo  │ Participants only  │ N/A             │
-- │ message_translations    │ Open (API)      │ If can see message │ N/A             │
-- │ message_scaled_texts    │ Open (API)      │ If can see message │ N/A             │
-- │ ai_chat_sessions        │ Own only        │ Own only           │ Own only        │
-- │ ai_chat_messages        │ Own session     │ Own session        │ N/A             │
-- └─────────────────────────┴─────────────────┴────────────────────┴─────────────────┘
--
-- KEY DESIGN DECISIONS:
-- 1. Profiles are publicly readable (needed for user discovery and chat headers)
-- 2. Conversations/messages are only visible to participants
-- 3. Users can only send messages as themselves and only to conversations they're in
-- 4. Translation inserts are open (API creates these server-side)
-- 5. conversation_participants SELECT only shows user's OWN records to avoid recursion
-- 6. Use get_conversation_participants_secure() function to safely fetch other participants
--
-- ============================================


-- ============================================
-- 1. DROP ALL EXISTING POLICIES
-- ============================================

-- conversations
DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
DROP POLICY IF EXISTS "Users can view conversations they participate in" ON conversations;
DROP POLICY IF EXISTS "Users can update their conversations" ON conversations;
DROP POLICY IF EXISTS "Users can update group conversations they admin" ON conversations;
DROP POLICY IF EXISTS "conversations_insert" ON conversations;
DROP POLICY IF EXISTS "conversations_select" ON conversations;
DROP POLICY IF EXISTS "conversations_update" ON conversations;

-- conversation_participants  
DROP POLICY IF EXISTS "Users can add participants to conversations" ON conversation_participants;
DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;
DROP POLICY IF EXISTS "Users can view participants" ON conversation_participants;
DROP POLICY IF EXISTS "Users can update their own participation" ON conversation_participants;
DROP POLICY IF EXISTS "participants_insert" ON conversation_participants;
DROP POLICY IF EXISTS "participants_select" ON conversation_participants;
DROP POLICY IF EXISTS "participants_update" ON conversation_participants;

-- messages
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
DROP POLICY IF EXISTS "Users can send messages to their conversations" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "messages_select" ON messages;

-- message_translations
DROP POLICY IF EXISTS "Users can view translations for their messages" ON message_translations;
DROP POLICY IF EXISTS "Anyone can create translations" ON message_translations;
DROP POLICY IF EXISTS "translations_insert" ON message_translations;
DROP POLICY IF EXISTS "translations_select" ON message_translations;

-- message_scaled_texts
DROP POLICY IF EXISTS "scaled_texts_insert" ON message_scaled_texts;
DROP POLICY IF EXISTS "scaled_texts_select" ON message_scaled_texts;

-- profiles
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;

-- ai_chat_sessions
DROP POLICY IF EXISTS "ai_chat_sessions_insert" ON ai_chat_sessions;
DROP POLICY IF EXISTS "ai_chat_sessions_select" ON ai_chat_sessions;
DROP POLICY IF EXISTS "ai_chat_sessions_update" ON ai_chat_sessions;
DROP POLICY IF EXISTS "ai_chat_sessions_delete" ON ai_chat_sessions;

-- ai_chat_messages
DROP POLICY IF EXISTS "ai_chat_messages_insert" ON ai_chat_messages;
DROP POLICY IF EXISTS "ai_chat_messages_select" ON ai_chat_messages;


-- ============================================
-- 2. ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_scaled_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;


-- ============================================
-- 3. PROFILES POLICIES
-- ============================================
-- Profiles are publicly readable (needed for user discovery, chat headers, etc.)
-- Users can only insert/update their own profile

CREATE POLICY "profiles_insert" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_select" ON profiles
    FOR SELECT USING (true);

CREATE POLICY "profiles_update" ON profiles
    FOR UPDATE USING (auth.uid() = id);


-- ============================================
-- 4. CONVERSATION_PARTICIPANTS POLICIES
-- ============================================
-- This is the key table that links users to conversations.
-- Insert: any authenticated user can add participants (needed when creating conversations)
-- Select: users can ONLY see their own participation records (prevents recursion)
-- Update: users can only update their own participation (hidden_at, cleared_at)
--
-- NOTE: To see other participants in a conversation, use the secure function
-- get_conversation_participants_secure() which validates caller membership first.

CREATE POLICY "participants_insert" ON conversation_participants
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "participants_select" ON conversation_participants
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "participants_update" ON conversation_participants
    FOR UPDATE USING (user_id = auth.uid());


-- ============================================
-- 4b. SECURE FUNCTION: Get Other Participants
-- ============================================
-- This function safely returns other participants in a conversation
-- ONLY if the calling user is also a participant. This avoids RLS recursion
-- while maintaining security.

CREATE OR REPLACE FUNCTION get_conversation_participants_secure(conv_id UUID)
RETURNS TABLE (
  id UUID,
  conversation_id UUID,
  user_id UUID,
  is_admin BOOLEAN,
  hidden_at TIMESTAMPTZ,
  cleared_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Security check: caller must be a participant in this conversation
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = conv_id 
    AND cp.user_id = auth.uid()
  ) THEN
    -- Return empty result if not authorized
    RETURN;
  END IF;
  
  -- Return all participants (caller is verified as member)
  RETURN QUERY
  SELECT 
    cp.id,
    cp.conversation_id,
    cp.user_id,
    cp.is_admin,
    cp.hidden_at,
    cp.cleared_at,
    cp.joined_at
  FROM conversation_participants cp
  WHERE cp.conversation_id = conv_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- 5. CONVERSATIONS POLICIES
-- ============================================
-- Insert: any authenticated user can create conversations
-- Select/Update: only participants can view/update

CREATE POLICY "conversations_insert" ON conversations
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "conversations_select" ON conversations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM conversation_participants 
            WHERE conversation_id = conversations.id 
            AND user_id = auth.uid()
        )
    );

CREATE POLICY "conversations_update" ON conversations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM conversation_participants 
            WHERE conversation_id = conversations.id 
            AND user_id = auth.uid()
        )
    );


-- ============================================
-- 6. MESSAGES POLICIES
-- ============================================
-- Insert: user must be the sender AND a participant in the conversation
-- Select: only participants of the conversation can read messages

CREATE POLICY "messages_insert" ON messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM conversation_participants 
            WHERE conversation_id = messages.conversation_id 
            AND user_id = auth.uid()
        )
    );

CREATE POLICY "messages_select" ON messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM conversation_participants 
            WHERE conversation_id = messages.conversation_id 
            AND user_id = auth.uid()
        )
    );


-- ============================================
-- 7. MESSAGE_TRANSLATIONS POLICIES
-- ============================================
-- Insert: open (translations are created by API server-side)
-- Select: only if user can see the parent message (is in the conversation)

CREATE POLICY "translations_insert" ON message_translations
    FOR INSERT WITH CHECK (true);

CREATE POLICY "translations_select" ON message_translations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM messages m
            JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
            WHERE m.id = message_translations.message_id
            AND cp.user_id = auth.uid()
        )
    );


-- ============================================
-- 7b. MESSAGE_SCALED_TEXTS POLICIES
-- ============================================
-- Insert: open (scaled texts are created by API/client)
-- Select: only if user can see the parent message (is in the conversation)

CREATE POLICY "scaled_texts_insert" ON message_scaled_texts
    FOR INSERT WITH CHECK (true);

CREATE POLICY "scaled_texts_select" ON message_scaled_texts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM messages m
            JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
            WHERE m.id = message_scaled_texts.message_id
            AND cp.user_id = auth.uid()
        )
    );


-- ============================================
-- 8. AI_CHAT_SESSIONS POLICIES
-- ============================================
-- Per-user AI chat sessions

CREATE POLICY "ai_chat_sessions_insert" ON ai_chat_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ai_chat_sessions_select" ON ai_chat_sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "ai_chat_sessions_update" ON ai_chat_sessions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "ai_chat_sessions_delete" ON ai_chat_sessions
    FOR DELETE USING (auth.uid() = user_id);


-- ============================================
-- 9. AI_CHAT_MESSAGES POLICIES
-- ============================================
-- Messages are only visible/insertable by the session owner

CREATE POLICY "ai_chat_messages_insert" ON ai_chat_messages
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM ai_chat_sessions s
            WHERE s.id = ai_chat_messages.session_id
            AND s.user_id = auth.uid()
        )
    );

CREATE POLICY "ai_chat_messages_select" ON ai_chat_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM ai_chat_sessions s
            WHERE s.id = ai_chat_messages.session_id
            AND s.user_id = auth.uid()
        )
    );


-- ============================================
-- END OF POLICIES
-- ============================================
