-- Allow participants to insert message status rows
drop policy if exists "message_status_insert_service_role" on "public"."message_status";

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
