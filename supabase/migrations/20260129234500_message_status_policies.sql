-- Tighten message_status insert/update to participants only
drop policy if exists "Users can update status for received messages" on "public"."message_status";
drop policy if exists "Users can update own message status" on "public"."message_status";

create policy "message_status_insert_participant"
on "public"."message_status"
as permissive
for insert
to public
with check (
  (user_id = auth.uid()) and
  (exists (
    select 1
    from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id
    where m.id = message_status.message_id
      and cp.user_id = auth.uid()
  ))
);

create policy "message_status_update_participant"
on "public"."message_status"
as permissive
for update
to public
using (
  (user_id = auth.uid()) and
  (exists (
    select 1
    from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id
    where m.id = message_status.message_id
      and cp.user_id = auth.uid()
  ))
)
with check (
  (user_id = auth.uid()) and
  (exists (
    select 1
    from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id
    where m.id = message_status.message_id
      and cp.user_id = auth.uid()
  ))
);
