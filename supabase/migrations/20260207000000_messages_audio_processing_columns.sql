-- Persist source audio for chat voice messages and track processing lifecycle.
alter table "public"."messages"
  add column if not exists "audio_path" text,
  add column if not exists "processing_status" text;

update "public"."messages"
set "processing_status" = 'ready'
where "processing_status" is null;

alter table "public"."messages"
  alter column "processing_status" set default 'ready',
  alter column "processing_status" set not null;

alter table "public"."messages"
  drop constraint if exists "messages_processing_status_check";

alter table "public"."messages"
  add constraint "messages_processing_status_check"
  check ("processing_status" in ('processing', 'ready', 'failed'));
