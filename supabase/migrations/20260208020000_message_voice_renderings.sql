create table if not exists public.message_voice_renderings (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_language text,
  target_language text not null,
  target_proficiency text check (target_proficiency in ('beginner', 'intermediate', 'advanced')),
  needs_translation boolean not null default false,
  needs_scaling boolean not null default false,
  transcript_text text not null,
  translated_text text,
  scaled_text text,
  final_text text not null,
  final_language text not null,
  final_audio_path text not null,
  processing_status text not null default 'processing'
    check (processing_status in ('processing', 'ready', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists idx_message_voice_renderings_user_id
  on public.message_voice_renderings (user_id);

create index if not exists idx_message_voice_renderings_message_id
  on public.message_voice_renderings (message_id);

alter table public.message_voice_renderings enable row level security;

create policy "voice_renderings_select_own"
  on public.message_voice_renderings
  for select
  to public
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.messages m
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id
      where m.id = message_voice_renderings.message_id
        and cp.user_id = auth.uid()
    )
  );

create policy "voice_renderings_insert_sender"
  on public.message_voice_renderings
  for insert
  to public
  with check (
    exists (
      select 1
      from public.messages m
      where m.id = message_voice_renderings.message_id
        and m.sender_id = auth.uid()
    )
    and exists (
      select 1
      from public.messages m
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id
      where m.id = message_voice_renderings.message_id
        and cp.user_id = message_voice_renderings.user_id
    )
  );

create policy "voice_renderings_update_sender"
  on public.message_voice_renderings
  for update
  to public
  using (
    exists (
      select 1
      from public.messages m
      where m.id = message_voice_renderings.message_id
        and m.sender_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.messages m
      where m.id = message_voice_renderings.message_id
        and m.sender_id = auth.uid()
    )
  );

