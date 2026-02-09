# Chat Workflows

## Mode Matrix

| Surface | Message Type | Locked Mode | Processing | Receiver Personalization | Sender Auto-Correction |
|---|---|---|---|---|---|
| Temporary AI (`/`) | Text | N/A | Request to `/api/ai-chat/temporary` | N/A | Optional, local-only analysis |
| Permanent AI (`/ai`) | Text | N/A | DB-backed AI chat flow | N/A | Optional, persisted in `ai_chat_message_corrections` |
| Personal/Group Chat | Text | `true` | None | None | None |
| Personal/Group Chat | Audio | `true` | None | None | None |
| Personal/Group Chat | Text | `false` | Translate/scale as needed | Yes (language/proficiency) | Optional, persisted in `message_corrections` |
| Personal/Group Chat | Audio | `false` | Transcribe, then translate/scale as needed, then synthesize TTS | Yes (language/proficiency + TTS voice/rate) | Optional, persisted in `message_corrections` |

`Locked mode` corresponds to `messages.bypass_recipient_preferences = true`.

## Locked Mode Contract

- No translation, no scaling, no correction generation.
- Message is immediately available (`messages.processing_status='ready'`).
- For locked audio, receiver playback uses original uploaded audio (`messages.audio_path`).

## Auto-Correction Contract

- Applies to sender-authored messages only when auto-correction is enabled.
- Trigger scope is realtime/new messages in the active session; no historical backfill generation on chat load.
- Chat/AI correction keeps the corrected sentence in the detected input language (no forced source language hint).
- Correction output includes corrected sentence, score, issues, suggestions, praise, and tip.
- Capitalization is evaluated as normal writing quality.
- Explanation/details open in an in-place modal (not navigation to Playground).

## Personal/Group Unlocked Text Flow

1. Sender inserts message.
2. Receiver-side flow resolves translation when language differs.
3. Receiver-side flow resolves scaling when proficiency is set.
4. Display uses final receiver text.
5. Optional read-aloud uses `/api/tts`.

## Personal/Group Unlocked Audio Flow

1. Sender uploads source audio to `voice-messages`.
2. Sender inserts message with `processing_status='processing'`.
3. Sender triggers `POST /api/voice-message/finalize`.
4. Finalize route transcribes once.
5. For each target recipient:
   - Translate when needed.
   - Scale when needed.
   - Try TTS synthesis/upload.
   - Write `message_voice_renderings` row (insert, or update on unique conflict).
6. Finalize route marks message `ready` after recipient rows are persisted.

## Audio Failure Handling

- Fatal failure (for example: auth failure, missing message, source audio download failure, transcription failure):
  - Message is marked `failed`.
- Recipient-level transform/TTS failure:
  - Message remains `ready`.
  - Recipient rendering row is still persisted with best available final text.
  - Rendering `processing_status='failed'` and `error_message` are stored.
  - Receiver still sees transcript/final text fallback even when synthesized playback is unavailable.

## UI Visibility Rules

- Conversation participants can see message rows in `processing`, `ready`, and `failed` states.
- Incoming unlocked audio playback requires recipient rendering `processing_status='ready'`.
- If recipient rendering is `failed`, transcript/final text remains visible as fallback.
- Voice transcript toggle (`CC`) is shown when playback is available.
- For unlocked voice messages, sender-side `CC` is shown once transcription is ready on the message row (`messages.original_text`).
