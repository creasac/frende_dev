# Interface Decisions

This file is the canonical UI/UX decision log for Frende interfaces.
When UI layout, interaction patterns, or visual behavior changes, update this file in the same change.

## Chat Message Layout Baseline

Updated: 2026-02-09

- Message timestamp is shown on the right for both outgoing and incoming text messages.
- Message action controls (read-aloud, transcript `CC`, and lock indicator when applicable) appear to the left of the timestamp for both outgoing and incoming messages.
- Message text content is left-aligned for both outgoing and incoming message bubbles.
- Text message bubbles in chat surfaces use a wider container (`max-w-[80%]`) to match temporary AI chat readability.
- Audio player box dimensions remain unchanged; only text bubble width/layout is adjusted.
- Text read-aloud buttons are persistent (always visible) for both outgoing and incoming text messages.
- Outgoing text read-aloud icon color uses the same off-white tone as outgoing timestamp text.
- Incoming voice-player play/pause icon follows the same metadata tone as incoming timestamp/CC controls for consistency.
- In dark mode, outgoing voice play/pause icon uses the same tone as outgoing timestamp metadata.
- In dark mode, incoming voice play/pause icon uses the same metadata tone used by incoming timestamp/CC controls.
- In light mode, incoming voice waveform bars use darker gray tones than the bubble for higher contrast.
- Sent unlocked voice messages show a `CC` toggle for the sender once transcription is ready, using `messages.original_text`.
- In dark mode, incoming voice play icon and both time labels use the same tone as incoming text-message timestamp metadata (`gray-900/75` mapping).
- In dark mode, incoming waveform played segment uses a brighter tone for clearer progress visibility.
- In dark mode, sent and received waveform progress/fill tones are aligned for consistency (`gray-950` active, `gray-700/55` inactive).
- In dark mode, incoming read-aloud and `CC` button icons use the same visible metadata tone (`gray-900/75`) in chat and AI chat message bubbles.

## Surfaces Covered

- `components/chat/MessageList.tsx` (personal/group chat)
- `components/chat/VoiceMessagePlayer.tsx` (voice message metadata row)
- `components/ai/AiMessageList.tsx` (saved AI sessions)
- `components/ai/TemporaryAiMessageList.tsx` (temporary AI chat timestamp alignment)
- `components/chat/ConversationList.tsx` and `app/(app)/chat/ChatInterface.tsx` use plain off-white AI avatar chips (no azure/gradient tint) in conversation list rows and selected AI header.
- In `components/chat/ConversationList.tsx`, AI thread subtitle omits redundant `AI` text; it now shows only available response metadata (language/level).

## Playground Header And Feature Cards

Updated: 2026-02-09

- Playground title row (star icon + `Playground`) is positioned slightly higher by reducing top and section spacing.
- Playground header uses only the `Playground` title text (star icon removed) and sits higher to align with top-shell controls.
- The descriptive subtitle under the Playground title is removed.
- Feature cards show only icon + feature name (no per-feature description copy).
- Feature card icon + label content is center-aligned.
- Active feature card no longer shows a `Selected` pill label.
- Active feature card uses border emphasis without blue background fill; icon background fill is removed.
- Playground input uses the same chat-style bottom composer pattern as other chat surfaces (mic + rounded input + action button), with no lock toggle.
- Feature-specific selectors are presented as compact, centered horizontal controls (`label + selector`) above the feature buttons.
- In Playground, the bottom control stack order is: feature-specific selector row (when applicable) -> four feature buttons -> input composer.
- Playground keeps keyboard flow focused on the input composer: after changing feature or selector controls, focus returns to the text input automatically.
- Playground content area remains empty (no placeholder section titles/text) for Alternatives, Correction, and Scale until results are generated, matching Translate's clean initial state.

## Discover Header

Updated: 2026-02-09

- Discover page header mirrors Playground style: title-only `Discover People` (no leading icon), smaller `text-2xl`/`font-semibold`, and reduced top spacing.
- Discover header subtitle text under the title is removed.
- Discover cards no longer include an in-card `Start Chat` action; chat initiation flows through profile pages.
- On other users' profiles, the primary chat CTA label is `Chat` (text-only) instead of icon + `Start Chat`.
- Discover profile grid is limited to two cards per row to keep cards wider, and bio previews show up to three lines.
