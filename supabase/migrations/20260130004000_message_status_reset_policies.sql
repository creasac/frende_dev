-- Reset message_status RLS policies to a known-good, participant-safe set
drop policy if exists "Users can update status for received messages" on "public"."message_status";
drop policy if exists "Users can update own message status" on "public"."message_status";
drop policy if exists "Users can view status of sent messages" on "public"."message_status";
drop policy if exists "message_status_insert_participant" on "public"."message_status";
drop policy if exists "message_status_update_participant" on "public"."message_status";
drop policy if exists "message_status_update_owner" on "public"."message_status";
drop policy if exists "message_status_insert_service_role" on "public"."message_status";
drop policy if exists "message_status_select_participants" on "public"."message_status";

create policy "message_status_select_participants"
on "public"."message_status"
as permissive
for select
to public
using (public.is_message_participant(message_id));

create policy "message_status_insert_participant"
on "public"."message_status"
as permissive
for insert
to public
with check (
  (user_id = auth.uid())
  and public.is_message_participant(message_id)
);

create policy "message_status_update_owner"
on "public"."message_status"
as permissive
for update
to public
using (user_id = auth.uid())
with check (user_id = auth.uid());
