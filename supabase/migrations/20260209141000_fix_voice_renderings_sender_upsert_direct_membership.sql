-- Keep sender upserts to message_voice_renderings deterministic by checking
-- conversation membership directly in a SECURITY DEFINER helper.

create or replace function public.can_sender_write_voice_rendering(
  p_message_id uuid,
  p_target_user_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $function$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and m.sender_id = auth.uid()
      and exists (
        select 1
        from public.conversation_participants cp
        where cp.conversation_id = m.conversation_id
          and cp.user_id = p_target_user_id
      )
  );
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
