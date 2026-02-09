# AGENTS.md

Repository-level instructions for AI coding agents working in this project.

## Scope

- This file applies to the whole repository.
- If a deeper folder adds its own `AGENTS.md`, the deeper file should only narrow/extend these rules.

## Required Context Read

- Before changing workflow/security/testing behavior, read:
  1. `README.md`
  2. `context/chat-workflows.md`
  3. `context/security-rls.md`
  4. `context/testing-release.md`
- Before changing UI layout/interaction behavior, read:
  1. `context/interface.md`
- `context/*` is the canonical context source. Keep it updated in the same change when behavior/policies/tests/UI decisions change.
- Avoid duplicating canonical context across multiple markdown files.

## Security Invariants (Do Not Break)

- Public profile reads must use `public.public_profiles`, not direct reads from `public.profiles`.
- `public.public_profiles` is limited to:
  - `id`
  - `username`
  - `display_name`
  - `bio`
  - `avatar_url`
- Conversation/message visibility must stay participant-only.
- Voice storage (`voice-messages`) must remain:
  - upload owner-only,
  - read participant-only (conversation participants, including sender).
- Inserts to `message_translations` and `message_scaled_texts` must remain participant-only.

## Database Change Policy

- Source of truth is `supabase/migrations/*`.
- Never rely on ad-hoc production SQL as the only copy of a schema change.
- Any RLS/storage/function change must include a migration and DB regression tests.
- Prefer least-privilege queries (only select columns required by UI).

## Required Validation

Run before merging:

1. `npm run lint`
2. `npm run test`
3. `npm run test:e2e`
4. `npm run test:db:local`

For DB/RLS changes, `test:db:local` is mandatory.

## Implementation Notes

- Keep app behavior, usability, and UI unchanged unless explicitly requested.
- Do not widen RLS/storage policies to “fix” failing tests; fix policy intent and tests together.
- If policy intent is unclear, ask for confirmation before loosening access.

## Testing Cost Guardrails

- Never call real AI provider APIs from automated tests (local or CI). We operate under limited/free credits.
- Any test touching AI-backed behavior must mock/stub provider calls (for example `@/lib/ai/gemini`) or stub app API routes.
- Do not add tests that rely on live model output or nondeterministic provider responses.
