-- Fix message_voice_renderings insert policy to work with self-only
-- conversation_participants RLS while still enforcing participant-only targets.

create or replace function public.is_conversation_participant_secure(
  conv_id uuid,
  participant_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $function$
  select exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = conv_id
      and cp.user_id = participant_id
  );
$function$;

revoke all on function public.is_conversation_participant_secure(uuid, uuid) from public;
grant execute on function public.is_conversation_participant_secure(uuid, uuid) to authenticated;
grant execute on function public.is_conversation_participant_secure(uuid, uuid) to service_role;

drop policy if exists "voice_renderings_insert_sender" on public.message_voice_renderings;

create policy "voice_renderings_insert_sender"
  on public.message_voice_renderings
  for insert
  to public
  with check (
    exists (
      select 1
      from public.messages m
      where m.id = message_voice_renderings.message_id
        and m.sender_id = auth.uid()
    )
    and exists (
      select 1
      from public.messages m
      where m.id = message_voice_renderings.message_id
        and public.is_conversation_participant_secure(
          m.conversation_id,
          message_voice_renderings.user_id
        )
    )
  );
