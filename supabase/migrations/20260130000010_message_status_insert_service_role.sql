-- Only service role can insert message status rows
drop policy if exists "message_status_insert_participant" on "public"."message_status";

create policy "message_status_insert_service_role"
on "public"."message_status"
as permissive
for insert
to service_role
with check (true);
