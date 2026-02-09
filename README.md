# Frende - Real-time Chat with Auto-Translation

A modern chat application with automatic message translation powered by Google Gemini. Connect with people who speak different languages effortlessly.

## Features

### Chat & Communication
- **Real-time messaging** - Instant message delivery via Supabase Realtime
- **Group chats** - Create multi-user conversations with per-user translation
- **Voice input with audio persistence** - Record audio, store it, and process transcription in the background
- **Auto-translation** - Messages automatically translated to receiver's preferred language
- **Smart translation caching** - Translations stored in database to avoid re-translating
- **Fast chat loading** - Progressive client-side prefetch for chat routes and message history to reduce click-to-open latency
- **Resilient retry queues** - Chat Gemini calls + transcription retry and persist across reloads
- **Online presence** - See who's online in real-time
- **Clear chat history** - Clear messages from your view without affecting other users
- **Message context menu** - Send to Playground, or reveal unscaled/original text

### AI Language Tools
- **AI Chat** - Session-based assistant with language/level controls
- **Home AI Chat** - Temporary AI chat at `/` (not saved)
- **Playground** - Unified hub at `/play/<feature>` with shared input and per-tool controls/results
- **Translate** - Translate text with style alternatives (Direct, Formal, Casual)
- **Alternatives** - Get 3 alternative ways to express your message (Professional, Friendly, Concise)
- **Correction** - Detailed corrections with scores, explanations, and word suggestions
- **Language Scaler** - Adjust text complexity to your proficiency level (Beginner/Intermediate/Advanced)

### Language Learning
- **Proficiency Setting** - Set your language proficiency level in Settings
- **Auto-scaling in Chat** - New incoming messages simplified and stored for reuse (no historical backfill)
- **Standalone Scaler** - Use the Scale tool to simplify any text on demand

### Social & Profile
- **Discover People** - Find and connect with other users
- **User Profiles** - View public profiles with bio and avatar
- **Profile Settings** - Edit your profile, change avatar, manage account

### Navigation
- **Persistent Sidebar** - Fixed left panel on app routes (except `/login` and `/signup`)
- **Guest Access** - `/`, `/play/*`, and `/discover` are usable without login
- **Protected Actions** - Creating chats/groups/AI sessions, profile, and settings require login prompts
- **Playground Routes** - Tools live at `/play/<feature>`
- **Clickable Profiles** - View user profiles from chat and discover pages
- **Chat → Playground** - Right-click a message and send it to a Playground tool (prefilled)

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend:** Supabase (PostgreSQL, Realtime, Auth)
- **AI:** Google Gemini (`gemini-2.5-flash`) for translation & transcription

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/timsinadipesh/frende_web.git
cd frende_web
npm install
```

### 2. Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEYS=your_gemini_api_keys
```

Or copy the template:
```bash
cp .env.example .env.local
```

### 3. Database Setup

Preferred: apply migrations from `supabase/migrations` to your **remote** Supabase:

```bash
npx supabase db push
```

Notes:
- `db push` requires direct DB access (port 5432) and may be blocked by **Network Restrictions**.
- If you see timeouts, allowlist your IP in **Supabase Dashboard → Database → Network Restrictions**,
  or run the migration SQL manually in the SQL Editor as a fallback.

Legacy (optional): run the SQL files in `sql/` via Supabase SQL Editor if needed:
- `sql/message_scaled_texts.sql`
- `sql/rls_policies.sql`

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Optional: One‑shot setup

For fresh clones, a single command installs exact deps and Playwright browsers:

```bash
npm run setup
```

## Testing

See `context/testing-release.md` for the full test strategy and commands. Quick start:

```bash
npm run lint
npm run test
```

Security baseline and policy invariants live in `context/security-rls.md`.
UI layout and interaction baseline lives in `context/interface.md`.
Agent guardrails live in `AGENTS.md`.

### Decision Authority

- Significant product/design/architecture decisions must be explicitly approved by the human owner before implementation.
- AI agents should not introduce major behavior/policy shifts (for example historical backfills or workflow changes) without that approval.

### Local Supabase (for DB/RLS tests)

Requires Docker and Supabase CLI availability (installed `supabase` CLI, or `npx` with npm registry access). Recommended deterministic DB test command:

```bash
npm run test:db:local
```

This command starts local Supabase, reapplies all migrations to a clean local DB, exports local env vars, and runs DB/RLS tests.

Manual mode (if you only want to run DB tests without reset):

```bash
npm run supabase:start
eval "$(npm run -s supabase:status)"
npm run test:db
```

If nothing is printed, export the keys shown by `supabase start`:
```bash
export SUPABASE_URL="http://127.0.0.1:54321"
export SUPABASE_ANON_KEY="sb_publishable_..."
export SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."
```

Notes:
- Local Supabase starts empty and is safe for testing.
- DB tests create and clean up their own seed data.

### Production DB release checklist

1. Add migration files to `supabase/migrations/*`.
2. Run `npm run lint`.
3. Run `npm run test`.
4. Run `npm run test:e2e`.
5. Run `npm run test:db:local`.
6. Push migration to remote Supabase: `npx supabase db push`.

## How It Works

1. **Send**: Type text or record voice
2. **Voice Store**: Audio is uploaded to storage
3. **Queue/Bypass**: Voice inserts as `processing` (or `ready` for send-as-is bypass)
4. **Finalize**: Backend transcribes + personalizes + synthesizes per participant (non-bypass) and persists `message_voice_renderings`
5. **Bypass Finalization**: Send-as-is can persist participant renderings that point to original uploaded audio
6. **Deliver**: Conversation participants can see processing/failed status; incoming non-bypass playback is available when their own rendering is `ready`

For the detailed playback path (Edge TTS synthesis, transcript behavior, and failure handling), see `context/chat-workflows.md`.

## Project Structure

```
/app
  /api
    /ai-chat         - AI chat responses (Gemini)
    /ai-chat/temporary - Temporary AI chat responses (Gemini)
    /transcribe      - Speech-to-text (Gemini)
    /translate       - Text translation (Gemini)
    /translate-with-alternatives - Translation with style variants
    /alternatives    - Sentence alternatives
    /correction      - Grammar checking
    /scale           - Language scaling (Gemini)
  /(app)
    /ai              - AI chat
    /page.tsx        - Home AI chat (temporary, not saved)
    /chat            - Chat interface (direct & group)
    /play            - Playground hub (shared input + per-tool panels at /play/<feature>)
    /discover        - Find and connect with users
    /profile/[username] - Public user profiles
    /settings        - Profile editing & account management
/components
  /chat              - Chat UI components
  /layout/AppShell   - Persistent left sidebar + auth prompt
/lib/chat          
  messages.ts        - Message logic + translation + retries
  conversations.ts   - Conversation management
  messageCache.ts    - In-memory chat message cache + progressive prefetch
  aiMessageCache.ts  - In-memory AI chat message cache + progressive prefetch
/lib/ai
  gemini.ts          - Gemini client + key rotation
  transcriptionQueue.ts - Persistent transcription retry queue
  apiRequestQueue.ts - Persistent JSON request retry queue
```

## Translation System

### Caching Strategy
- All translations are cached in `message_translations` table
- Check database first before calling Gemini API
- Reduces API quota usage and improves response time
 - Scaled chat outputs are cached in `message_scaled_texts` for each language + proficiency

### Retry Queues
- Client-side queues retry Gemini requests on transient failures
- Chat requests (translation/scaling/AI chat/transcription) persist across reloads
- Tool pages retry in-memory while the page is open

Canonical implementation context for agents lives in `context/`.
