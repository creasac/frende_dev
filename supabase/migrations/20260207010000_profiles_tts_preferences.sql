alter table public.profiles
  add column if not exists tts_voice text;

alter table public.profiles
  add column if not exists tts_rate smallint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_tts_rate_range'
  ) then
    alter table public.profiles
      add constraint profiles_tts_rate_range
      check (tts_rate >= -50 and tts_rate <= 50);
  end if;
end $$;
