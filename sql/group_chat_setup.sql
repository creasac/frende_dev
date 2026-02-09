-- Group Chat Feature Setup SQL
-- Run this in your Supabase SQL Editor to ensure group chat support
-- 
-- NOTE: For RLS policies, use rls_policies.sql instead. This file only handles
-- schema changes (columns, indexes). All security policies are centralized in rls_policies.sql.

-- 1. Ensure conversations table has group columns (if not already present)
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS group_name TEXT,
ADD COLUMN IF NOT EXISTS group_avatar_url TEXT;

-- 2. Create index for better query performance on group conversations
CREATE INDEX IF NOT EXISTS idx_conversations_is_group ON conversations(is_group);

-- 3. RLS POLICIES ARE NOW IN rls_policies.sql
-- Run that file to set up all security policies.
-- This prevents policy conflicts and ensures a single source of truth.

-- ============================================
-- IMPORTANT: Run rls_policies.sql after this file
-- to set up all Row Level Security policies.
-- ============================================
