-- Ensure storage policies are enforced (ignore if lacking privileges in local reset)
do $$
begin
  alter table if exists storage.objects enable row level security;
exception
  when insufficient_privilege then
    raise notice 'Skipping storage.objects RLS enable due to insufficient privilege';
end $$;
