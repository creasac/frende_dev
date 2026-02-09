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
    and (
      messages.sender_id = auth.uid()
      or coalesce(messages.processing_status, 'ready') <> 'processing'
    )
    and messages.deleted_for_everyone_by is null
    and not (auth.uid() = any (messages.deleted_for_users))
  );

