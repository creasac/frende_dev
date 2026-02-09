-- Harden voice rendering sender writes to avoid false negatives from RLS-limited joins.
-- This migration is idempotent and safe to re-run.

create or replace function public.can_sender_write_voice_rendering(
  p_message_id uuid,
  p_target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $function$
declare
  requester_id uuid := auth.uid();
  conv_id uuid;
begin
  if requester_id is null then
    return false;
  end if;

  select m.conversation_id
  into conv_id
  from public.messages m
  where m.id = p_message_id
    and m.sender_id = requester_id;

  if conv_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = conv_id
      and cp.user_id = p_target_user_id
  );
end;
$function$;

revoke all on function public.can_sender_write_voice_rendering(uuid, uuid) from public;
grant execute on function public.can_sender_write_voice_rendering(uuid, uuid) to authenticated;
grant execute on function public.can_sender_write_voice_rendering(uuid, uuid) to service_role;

drop policy if exists "voice_renderings_insert_sender" on public.message_voice_renderings;
create policy "voice_renderings_insert_sender"
  on public.message_voice_renderings
  for insert
  to authenticated
  with check (
    public.can_sender_write_voice_rendering(
      message_voice_renderings.message_id,
      message_voice_renderings.user_id
    )
  );

drop policy if exists "voice_renderings_update_sender" on public.message_voice_renderings;
create policy "voice_renderings_update_sender"
  on public.message_voice_renderings
  for update
  to authenticated
  using (
    public.can_sender_write_voice_rendering(
      message_voice_renderings.message_id,
      message_voice_renderings.user_id
    )
  )
  with check (
    public.can_sender_write_voice_rendering(
      message_voice_renderings.message_id,
      message_voice_renderings.user_id
    )
  );
