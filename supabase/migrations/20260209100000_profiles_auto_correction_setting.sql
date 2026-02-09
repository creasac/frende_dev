alter table public.profiles
  add column if not exists auto_correction_enabled boolean;

update public.profiles
set auto_correction_enabled = true
where auto_correction_enabled is null;

alter table public.profiles
  alter column auto_correction_enabled set default true,
  alter column auto_correction_enabled set not null;

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
as $function$
BEGIN
  INSERT INTO public.profiles (
    id,
    username,
    display_name,
    language_preference,
    feedback_language,
    auto_correction_enabled
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'language_preference', 'en'),
    COALESCE(
      NEW.raw_user_meta_data->>'feedback_language',
      NEW.raw_user_meta_data->>'language_preference',
      'en'
    ),
    CASE
      WHEN lower(COALESCE(NEW.raw_user_meta_data->>'auto_correction_enabled', '')) IN ('true', 'false')
        THEN (NEW.raw_user_meta_data->>'auto_correction_enabled')::boolean
      ELSE true
    END
  );
  RETURN NEW;
END;
$function$;
