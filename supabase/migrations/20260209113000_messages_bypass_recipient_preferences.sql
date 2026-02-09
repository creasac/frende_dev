-- Per-message flag to bypass recipient translation/scaling/voice rendering preferences.
alter table public.messages
  add column if not exists bypass_recipient_preferences boolean;

update public.messages
set bypass_recipient_preferences = false
where bypass_recipient_preferences is null;

alter table public.messages
  alter column bypass_recipient_preferences set default false,
  alter column bypass_recipient_preferences set not null;

-- Prevent translation/scaling inserts for "as-is" messages.
drop policy if exists "message_translations_insert_participant" on public.message_translations;
drop policy if exists "message_translations_insert_service_role" on public.message_translations;
drop policy if exists "message_scaled_texts_insert_participant" on public.message_scaled_texts;
drop policy if exists "message_scaled_texts_insert_service_role" on public.message_scaled_texts;

create policy "message_translations_insert_participant"
  on public.message_translations
  as permissive
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.messages m
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id
      where m.id = message_translations.message_id
        and cp.user_id = auth.uid()
        and coalesce(m.bypass_recipient_preferences, false) = false
    )
  );

create policy "message_translations_insert_service_role"
  on public.message_translations
  as permissive
  for insert
  to service_role
  with check (
    exists (
      select 1
      from public.messages m
      where m.id = message_translations.message_id
        and coalesce(m.bypass_recipient_preferences, false) = false
    )
  );

create policy "message_scaled_texts_insert_participant"
  on public.message_scaled_texts
  as permissive
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.messages m
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id
      where m.id = message_scaled_texts.message_id
        and cp.user_id = auth.uid()
        and coalesce(m.bypass_recipient_preferences, false) = false
    )
  );

create policy "message_scaled_texts_insert_service_role"
  on public.message_scaled_texts
  as permissive
  for insert
  to service_role
  with check (
    exists (
      select 1
      from public.messages m
      where m.id = message_scaled_texts.message_id
        and coalesce(m.bypass_recipient_preferences, false) = false
    )
  );
