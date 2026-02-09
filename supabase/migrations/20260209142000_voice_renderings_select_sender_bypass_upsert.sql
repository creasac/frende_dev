-- PostgREST upsert on message_voice_renderings requires sender visibility on
-- conflict targets. Keep this narrow to bypass messages only.

drop policy if exists "voice_renderings_select_sender_bypass" on public.message_voice_renderings;

create policy "voice_renderings_select_sender_bypass"
  on public.message_voice_renderings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.messages m
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id
      where m.id = message_voice_renderings.message_id
        and m.sender_id = auth.uid()
        and m.bypass_recipient_preferences = true
        and cp.user_id = auth.uid()
    )
  );
