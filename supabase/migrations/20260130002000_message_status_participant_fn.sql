-- Use a security definer helper to avoid RLS recursion issues in policies
create or replace function public.is_message_participant(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id
    where m.id = p_message_id
      and cp.user_id = auth.uid()
  );
$$;

grant execute on function public.is_message_participant(uuid) to public;

drop policy if exists "message_status_insert_participant" on "public"."message_status";
drop policy if exists "message_status_update_participant" on "public"."message_status";

create policy "message_status_insert_participant"
on "public"."message_status"
as permissive
for insert
to public
with check (
  (user_id = auth.uid())
  and public.is_message_participant(message_id)
);

create policy "message_status_update_participant"
on "public"."message_status"
as permissive
for update
to public
using (
  (user_id = auth.uid())
  and public.is_message_participant(message_id)
)
with check (
  (user_id = auth.uid())
  and public.is_message_participant(message_id)
);
