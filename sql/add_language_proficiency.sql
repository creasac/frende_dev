-- Add language_proficiency column to profiles table
-- This column is used for the language scaling feature for learners

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS language_proficiency TEXT 
CHECK (language_proficiency IN ('beginner', 'intermediate', 'advanced') OR language_proficiency IS NULL);

-- Add comment to document the column
COMMENT ON COLUMN profiles.language_proficiency IS 'Optional proficiency level for language learners. When set, incoming messages are scaled to this complexity level. Values: beginner (A1-A2), intermediate (B1-B2), advanced (C1-C2), or NULL (disabled).';
