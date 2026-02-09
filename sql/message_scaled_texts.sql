-- Message Scaled Texts Setup SQL
-- Run this in your Supabase SQL Editor to enable stored scaled messages
--
-- NOTE: For RLS policies, use rls_policies.sql instead. This file only handles
-- schema changes (tables, indexes). All security policies are centralized in rls_policies.sql.

CREATE TABLE IF NOT EXISTS message_scaled_texts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  target_language TEXT NOT NULL,
  target_proficiency TEXT NOT NULL CHECK (target_proficiency IN ('beginner', 'intermediate', 'advanced')),
  scaled_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure one scaled version per message + language + proficiency
CREATE UNIQUE INDEX IF NOT EXISTS message_scaled_texts_unique
  ON message_scaled_texts(message_id, target_language, target_proficiency);

CREATE INDEX IF NOT EXISTS message_scaled_texts_message_id
  ON message_scaled_texts(message_id);

-- IMPORTANT: Run rls_policies.sql after this file
-- to set up all Row Level Security policies.
