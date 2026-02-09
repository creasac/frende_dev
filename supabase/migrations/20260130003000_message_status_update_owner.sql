-- Allow users to update their own message status rows (insert remains participant-only)
drop policy if exists "message_status_update_participant" on "public"."message_status";

create policy "message_status_update_owner"
on "public"."message_status"
as permissive
for update
to public
using (user_id = auth.uid())
with check (user_id = auth.uid());
