-- Show processing/failed messages to all conversation participants so clients can render
-- "processing..." / "failed" states in real time.

drop policy if exists "Users can view messages in own conversations" on public.messages;
drop policy if exists "messages_select" on public.messages;

create policy "messages_select"
  on public.messages
  for select
  to public
  using (
    exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.user_id = auth.uid()
    )
    and messages.deleted_for_everyone_by is null
    and not (auth.uid() = any (messages.deleted_for_users))
  );
