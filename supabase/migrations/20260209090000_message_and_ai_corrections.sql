alter table public.profiles
  add column if not exists feedback_language character varying(5);

update public.profiles
set feedback_language = coalesce(feedback_language, language_preference, 'en')
where feedback_language is null;

alter table public.profiles
  alter column feedback_language set default 'en',
  alter column feedback_language set not null;

create table if not exists public.message_corrections (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  feedback_language character varying(5) not null,
  original_text text not null,
  corrected_sentence text not null,
  overall_score integer not null,
  issues jsonb not null default '[]'::jsonb,
  word_suggestions jsonb not null default '[]'::jsonb,
  praise text,
  tip text,
  has_issues boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint message_corrections_overall_score_range
    check (overall_score >= 0 and overall_score <= 100)
);

create unique index if not exists message_corrections_message_user_unique
  on public.message_corrections (message_id, user_id);

create index if not exists idx_message_corrections_user_id
  on public.message_corrections (user_id);

create table if not exists public.ai_chat_message_corrections (
  id uuid primary key default gen_random_uuid(),
  ai_message_id uuid not null references public.ai_chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  feedback_language character varying(5) not null,
  original_text text not null,
  corrected_sentence text not null,
  overall_score integer not null,
  issues jsonb not null default '[]'::jsonb,
  word_suggestions jsonb not null default '[]'::jsonb,
  praise text,
  tip text,
  has_issues boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint ai_chat_message_corrections_overall_score_range
    check (overall_score >= 0 and overall_score <= 100)
);

create unique index if not exists ai_chat_message_corrections_message_user_unique
  on public.ai_chat_message_corrections (ai_message_id, user_id);

create index if not exists idx_ai_chat_message_corrections_user_id
  on public.ai_chat_message_corrections (user_id);

alter table public.message_corrections enable row level security;
alter table public.ai_chat_message_corrections enable row level security;

drop policy if exists "message_corrections_select_owner" on public.message_corrections;
create policy "message_corrections_select_owner"
  on public.message_corrections
  for select
  to public
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.messages m
      where m.id = message_corrections.message_id
        and m.sender_id = auth.uid()
    )
  );

drop policy if exists "message_corrections_insert_owner" on public.message_corrections;
create policy "message_corrections_insert_owner"
  on public.message_corrections
  for insert
  to public
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.messages m
      where m.id = message_corrections.message_id
        and m.sender_id = auth.uid()
    )
  );

drop policy if exists "message_corrections_update_owner" on public.message_corrections;
create policy "message_corrections_update_owner"
  on public.message_corrections
  for update
  to public
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.messages m
      where m.id = message_corrections.message_id
        and m.sender_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.messages m
      where m.id = message_corrections.message_id
        and m.sender_id = auth.uid()
    )
  );

drop policy if exists "ai_chat_message_corrections_select_owner" on public.ai_chat_message_corrections;
create policy "ai_chat_message_corrections_select_owner"
  on public.ai_chat_message_corrections
  for select
  to public
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.ai_chat_messages m
      join public.ai_chat_sessions s
        on s.id = m.session_id
      where m.id = ai_chat_message_corrections.ai_message_id
        and m.role = 'user'
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "ai_chat_message_corrections_insert_owner" on public.ai_chat_message_corrections;
create policy "ai_chat_message_corrections_insert_owner"
  on public.ai_chat_message_corrections
  for insert
  to public
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.ai_chat_messages m
      join public.ai_chat_sessions s
        on s.id = m.session_id
      where m.id = ai_chat_message_corrections.ai_message_id
        and m.role = 'user'
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "ai_chat_message_corrections_update_owner" on public.ai_chat_message_corrections;
create policy "ai_chat_message_corrections_update_owner"
  on public.ai_chat_message_corrections
  for update
  to public
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.ai_chat_messages m
      join public.ai_chat_sessions s
        on s.id = m.session_id
      where m.id = ai_chat_message_corrections.ai_message_id
        and m.role = 'user'
        and s.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.ai_chat_messages m
      join public.ai_chat_sessions s
        on s.id = m.session_id
      where m.id = ai_chat_message_corrections.ai_message_id
        and m.role = 'user'
        and s.user_id = auth.uid()
    )
  );

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
as $function$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, language_preference, feedback_language)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'language_preference', 'en'),
    COALESCE(
      NEW.raw_user_meta_data->>'feedback_language',
      NEW.raw_user_meta_data->>'language_preference',
      'en'
    )
  );
  RETURN NEW;
END;
$function$;
