# Security and RLS

## Invariants

| Domain | Invariant |
|---|---|
| Public profile data | Public reads must use `public.public_profiles` only. |
| Public profile columns | `id`, `username`, `display_name`, `bio`, `avatar_url` only. |
| Conversation visibility | Messages/metadata remain participant-scoped. |
| Voice storage bucket | `voice-messages`: upload owner-only, read participant-only. |
| Translation/scaling writes | `message_translations` and `message_scaled_texts` inserts remain participant-only. |

## Voice Storage Path Contract

| Artifact | Path |
|---|---|
| Source voice | `<sender_id>/<conversation_id>/<file>` |
| Finalized TTS | `<sender_id>/<message_id>/tts-<recipient_id>-<hash>.mp3` |

## Voice Rendering RLS Model (`public.message_voice_renderings`)

| Action | Who | Rule |
|---|---|---|
| `SELECT` own rendering | Authenticated user | User can read own row when they are conversation participant. |
| `INSERT`/`UPDATE` recipient rendering | Message sender | Sender can write recipient rows only for message conversation participants. |
| `SELECT` sender bypass rows | Message sender | Sender can read rows for own bypass messages (narrow compatibility policy). |

Notes:
- Sender bypass-row select is intentionally narrow and does not grant outsider access.
- Any policy/function change must be migration-backed and DB-tested.

## Membership and Preference Access

- Conversation membership inserts are gated by `can_insert_conversation_participant(...)`.
- Cross-user language/TTS preference reads must use `get_conversation_participant_preferences_secure(conv_id)`.
- Do not broaden `profiles` direct read access for convenience.
