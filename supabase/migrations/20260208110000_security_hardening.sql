-- Step 1 security hardening: participant membership, storage access, and profile exposure

-- ---------------------------------------------------------------------------
-- conversation_participants: prevent arbitrary membership insertion
-- ---------------------------------------------------------------------------
drop policy if exists "Users can add participants" on public.conversation_participants;
drop policy if exists "participants_insert" on public.conversation_participants;

create or replace function public.can_insert_conversation_participant(
  p_conversation_id uuid,
  p_target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  requester_id uuid := auth.uid();
  conversation_is_group boolean := false;
  requester_is_admin boolean := false;
  requester_is_participant boolean := false;
  participant_count integer := 0;
begin
  if requester_id is null then
    return false;
  end if;

  select c.is_group
  into conversation_is_group
  from public.conversations c
  where c.id = p_conversation_id;

  if not found then
    return false;
  end if;

  select count(*)
  into participant_count
  from public.conversation_participants cp
  where cp.conversation_id = p_conversation_id;

  select exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = requester_id
  )
  into requester_is_participant;

  select exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = requester_id
      and cp.is_admin = true
  )
  into requester_is_admin;

  -- A user can only bootstrap themselves into an empty conversation,
  -- or reinsert their own row when they are already a participant.
  if p_target_user_id = requester_id then
    return participant_count = 0 or requester_is_participant;
  end if;

  if exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = p_target_user_id
  ) then
    return false;
  end if;

  if not requester_is_participant then
    return false;
  end if;

  if conversation_is_group then
    return requester_is_admin;
  end if;

  -- Direct conversations allow adding the second participant only during bootstrap.
  return participant_count = 1;
end;
$function$;

revoke all on function public.can_insert_conversation_participant(uuid, uuid) from public;
grant execute on function public.can_insert_conversation_participant(uuid, uuid) to authenticated;
grant execute on function public.can_insert_conversation_participant(uuid, uuid) to service_role;

create policy "conversation_participants_insert_service_role"
  on public.conversation_participants
  as permissive
  for insert
  to service_role
  with check (true);

create policy "conversation_participants_insert_self_or_admin"
  on public.conversation_participants
  as permissive
  for insert
  to authenticated
  with check (
    public.can_insert_conversation_participant(
      conversation_participants.conversation_id,
      conversation_participants.user_id
    )
  );

-- Ensure legacy groups created without admins continue to be manageable.
with groups_without_admin as (
  select cp.conversation_id
  from public.conversation_participants cp
  join public.conversations c
    on c.id = cp.conversation_id
  where c.is_group = true
  group by cp.conversation_id
  having bool_or(cp.is_admin) = false
),
first_members as (
  select distinct on (cp.conversation_id) cp.id
  from public.conversation_participants cp
  join groups_without_admin gwa
    on gwa.conversation_id = cp.conversation_id
  order by cp.conversation_id, cp.joined_at asc, cp.id asc
)
update public.conversation_participants cp
set is_admin = true
from first_members fm
where cp.id = fm.id;

-- ---------------------------------------------------------------------------
-- message_translations / message_scaled_texts: participant-only inserts
-- ---------------------------------------------------------------------------
drop policy if exists "Service role can insert translations" on public.message_translations;
drop policy if exists "translations_insert" on public.message_translations;
drop policy if exists "scaled_texts_insert" on public.message_scaled_texts;

create policy "message_translations_insert_participant"
  on public.message_translations
  as permissive
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.messages m
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id
      where m.id = message_translations.message_id
        and cp.user_id = auth.uid()
    )
  );

create policy "message_translations_insert_service_role"
  on public.message_translations
  as permissive
  for insert
  to service_role
  with check (true);

create policy "message_scaled_texts_insert_participant"
  on public.message_scaled_texts
  as permissive
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.messages m
      join public.conversation_participants cp
        on cp.conversation_id = m.conversation_id
      where m.id = message_scaled_texts.message_id
        and cp.user_id = auth.uid()
    )
  );

create policy "message_scaled_texts_insert_service_role"
  on public.message_scaled_texts
  as permissive
  for insert
  to service_role
  with check (true);

-- ---------------------------------------------------------------------------
-- storage.objects (voice-messages): owner upload + participant read
-- ---------------------------------------------------------------------------
drop policy if exists "Users can upload voice messages 16ecuiv_0" on storage.objects;
drop policy if exists "Users can view voice messages 16ecuiv_0" on storage.objects;

create policy "voice_messages_insert_owner_only"
  on storage.objects
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'voice-messages'
    and (auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "voice_messages_select_participants"
  on storage.objects
  as permissive
  for select
  to authenticated
  using (
    bucket_id = 'voice-messages'
    and (
      (auth.uid())::text = (storage.foldername(name))[1]
      or exists (
        select 1
        from public.conversation_participants cp
        where cp.conversation_id::text = (storage.foldername(name))[2]
          and cp.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.messages m
        join public.conversation_participants cp
          on cp.conversation_id = m.conversation_id
        where m.id::text = (storage.foldername(name))[2]
          and cp.user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- profiles: self-only table access + explicit public projection
-- ---------------------------------------------------------------------------
drop policy if exists "Anyone can view profiles" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;

create policy "profiles_select_own"
  on public.profiles
  as permissive
  for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_select_service_role"
  on public.profiles
  as permissive
  for select
  to service_role
  using (true);

create or replace view public.public_profiles as
select
  p.id,
  p.username,
  p.display_name,
  p.bio,
  p.avatar_url
from public.profiles p;

grant select on public.public_profiles to anon;
grant select on public.public_profiles to authenticated;
grant select on public.public_profiles to service_role;

-- Secure profile preference access for conversation participants.
create or replace function public.get_conversation_participant_preferences_secure(conv_id uuid)
returns table(
  id uuid,
  language_preference character varying,
  language_proficiency text,
  tts_voice text,
  tts_rate smallint
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    return;
  end if;

  if not exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = conv_id
      and cp.user_id = auth.uid()
  ) then
    return;
  end if;

  return query
  select
    p.id,
    p.language_preference,
    p.language_proficiency,
    p.tts_voice,
    p.tts_rate
  from public.conversation_participants cp
  join public.profiles p
    on p.id = cp.user_id
  where cp.conversation_id = conv_id;
end;
$function$;

revoke all on function public.get_conversation_participant_preferences_secure(uuid) from public;
grant execute on function public.get_conversation_participant_preferences_secure(uuid) to authenticated;
grant execute on function public.get_conversation_participant_preferences_secure(uuid) to service_role;
