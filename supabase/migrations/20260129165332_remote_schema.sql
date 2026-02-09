drop extension if exists "pg_net";


  create table "public"."ai_chat_messages" (
    "id" uuid not null default gen_random_uuid(),
    "session_id" uuid not null,
    "role" text not null,
    "content" text not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."ai_chat_messages" enable row level security;


  create table "public"."ai_chat_sessions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "name" text not null,
    "system_prompt" text,
    "response_language" text,
    "response_level" text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."ai_chat_sessions" enable row level security;


  create table "public"."conversation_participants" (
    "id" uuid not null default gen_random_uuid(),
    "conversation_id" uuid,
    "user_id" uuid,
    "joined_at" timestamp with time zone default now(),
    "is_admin" boolean default false,
    "hidden_at" timestamp with time zone,
    "cleared_at" timestamp with time zone
      );


alter table "public"."conversation_participants" enable row level security;


  create table "public"."conversations" (
    "id" uuid not null default gen_random_uuid(),
    "is_group" boolean default false,
    "group_name" character varying(100),
    "group_avatar_url" text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."conversations" enable row level security;


  create table "public"."interpreter_exchanges" (
    "id" uuid not null default gen_random_uuid(),
    "session_id" uuid,
    "user_id" uuid,
    "input_text" text not null,
    "input_language" character varying(5) not null,
    "input_audio_url" text,
    "output_text" text not null,
    "output_language" character varying(5) not null,
    "output_audio_url" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."interpreter_exchanges" enable row level security;


  create table "public"."interpreter_sessions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid,
    "session_name" character varying(100),
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."interpreter_sessions" enable row level security;


  create table "public"."message_scaled_texts" (
    "id" uuid not null default gen_random_uuid(),
    "message_id" uuid not null,
    "target_language" text not null,
    "target_proficiency" text not null,
    "scaled_text" text not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."message_scaled_texts" enable row level security;


  create table "public"."message_status" (
    "id" uuid not null default gen_random_uuid(),
    "message_id" uuid,
    "user_id" uuid,
    "status" character varying(20) not null,
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."message_status" enable row level security;


  create table "public"."message_translations" (
    "id" uuid not null default gen_random_uuid(),
    "message_id" uuid,
    "target_language" character varying(5) not null,
    "translated_text" text not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."message_translations" enable row level security;


  create table "public"."messages" (
    "id" uuid not null default gen_random_uuid(),
    "conversation_id" uuid,
    "sender_id" uuid,
    "content_type" character varying(20) not null,
    "original_text" text,
    "original_language" character varying(5),
    "deleted_for_users" uuid[] default '{}'::uuid[],
    "deleted_for_everyone_by" uuid,
    "deleted_for_everyone_at" timestamp with time zone,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."messages" enable row level security;


  create table "public"."profiles" (
    "id" uuid not null,
    "username" character varying(30) not null,
    "phone_number" character varying(20),
    "display_name" character varying(100) not null,
    "bio" text,
    "avatar_url" text,
    "language_preference" character varying(5) not null default 'en'::character varying,
    "created_at" timestamp with time zone default now(),
    "last_seen" timestamp with time zone default now(),
    "language_proficiency" text
      );


alter table "public"."profiles" enable row level security;

CREATE UNIQUE INDEX ai_chat_messages_pkey ON public.ai_chat_messages USING btree (id);

CREATE UNIQUE INDEX ai_chat_sessions_pkey ON public.ai_chat_sessions USING btree (id);

CREATE UNIQUE INDEX conversation_participants_conversation_id_user_id_key ON public.conversation_participants USING btree (conversation_id, user_id);

CREATE UNIQUE INDEX conversation_participants_pkey ON public.conversation_participants USING btree (id);

CREATE UNIQUE INDEX conversations_pkey ON public.conversations USING btree (id);

CREATE INDEX idx_ai_chat_messages_created_at ON public.ai_chat_messages USING btree (created_at);

CREATE INDEX idx_ai_chat_messages_session_id ON public.ai_chat_messages USING btree (session_id);

CREATE INDEX idx_ai_chat_sessions_user_id ON public.ai_chat_sessions USING btree (user_id);

CREATE INDEX idx_conversation_participants_conversation ON public.conversation_participants USING btree (conversation_id);

CREATE INDEX idx_conversation_participants_hidden_at ON public.conversation_participants USING btree (user_id, hidden_at);

CREATE INDEX idx_conversation_participants_user ON public.conversation_participants USING btree (user_id);

CREATE INDEX idx_conversations_is_group ON public.conversations USING btree (is_group);

CREATE INDEX idx_interpreter_exchanges_session ON public.interpreter_exchanges USING btree (session_id, created_at);

CREATE INDEX idx_interpreter_sessions_user ON public.interpreter_sessions USING btree (user_id, created_at DESC);

CREATE INDEX idx_message_status_user ON public.message_status USING btree (user_id, message_id);

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id, created_at DESC);

CREATE INDEX idx_messages_sender ON public.messages USING btree (sender_id);

CREATE INDEX idx_profiles_phone ON public.profiles USING btree (phone_number);

CREATE INDEX idx_profiles_username ON public.profiles USING btree (username);

CREATE UNIQUE INDEX interpreter_exchanges_pkey ON public.interpreter_exchanges USING btree (id);

CREATE UNIQUE INDEX interpreter_sessions_pkey ON public.interpreter_sessions USING btree (id);

CREATE INDEX message_scaled_texts_message_id ON public.message_scaled_texts USING btree (message_id);

CREATE UNIQUE INDEX message_scaled_texts_pkey ON public.message_scaled_texts USING btree (id);

CREATE UNIQUE INDEX message_scaled_texts_unique ON public.message_scaled_texts USING btree (message_id, target_language, target_proficiency);

CREATE UNIQUE INDEX message_status_message_id_user_id_key ON public.message_status USING btree (message_id, user_id);

CREATE UNIQUE INDEX message_status_pkey ON public.message_status USING btree (id);

CREATE UNIQUE INDEX message_translations_message_id_target_language_key ON public.message_translations USING btree (message_id, target_language);

CREATE UNIQUE INDEX message_translations_pkey ON public.message_translations USING btree (id);

CREATE UNIQUE INDEX messages_pkey ON public.messages USING btree (id);

CREATE UNIQUE INDEX profiles_phone_number_key ON public.profiles USING btree (phone_number);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);

CREATE UNIQUE INDEX profiles_username_key ON public.profiles USING btree (username);

alter table "public"."ai_chat_messages" add constraint "ai_chat_messages_pkey" PRIMARY KEY using index "ai_chat_messages_pkey";

alter table "public"."ai_chat_sessions" add constraint "ai_chat_sessions_pkey" PRIMARY KEY using index "ai_chat_sessions_pkey";

alter table "public"."conversation_participants" add constraint "conversation_participants_pkey" PRIMARY KEY using index "conversation_participants_pkey";

alter table "public"."conversations" add constraint "conversations_pkey" PRIMARY KEY using index "conversations_pkey";

alter table "public"."interpreter_exchanges" add constraint "interpreter_exchanges_pkey" PRIMARY KEY using index "interpreter_exchanges_pkey";

alter table "public"."interpreter_sessions" add constraint "interpreter_sessions_pkey" PRIMARY KEY using index "interpreter_sessions_pkey";

alter table "public"."message_scaled_texts" add constraint "message_scaled_texts_pkey" PRIMARY KEY using index "message_scaled_texts_pkey";

alter table "public"."message_status" add constraint "message_status_pkey" PRIMARY KEY using index "message_status_pkey";

alter table "public"."message_translations" add constraint "message_translations_pkey" PRIMARY KEY using index "message_translations_pkey";

alter table "public"."messages" add constraint "messages_pkey" PRIMARY KEY using index "messages_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."ai_chat_messages" add constraint "ai_chat_messages_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))) not valid;

alter table "public"."ai_chat_messages" validate constraint "ai_chat_messages_role_check";

alter table "public"."ai_chat_messages" add constraint "ai_chat_messages_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.ai_chat_sessions(id) ON DELETE CASCADE not valid;

alter table "public"."ai_chat_messages" validate constraint "ai_chat_messages_session_id_fkey";

alter table "public"."ai_chat_sessions" add constraint "ai_chat_sessions_response_level_check" CHECK ((response_level = ANY (ARRAY['beginner'::text, 'intermediate'::text, 'advanced'::text]))) not valid;

alter table "public"."ai_chat_sessions" validate constraint "ai_chat_sessions_response_level_check";

alter table "public"."ai_chat_sessions" add constraint "ai_chat_sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."ai_chat_sessions" validate constraint "ai_chat_sessions_user_id_fkey";

alter table "public"."conversation_participants" add constraint "conversation_participants_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE not valid;

alter table "public"."conversation_participants" validate constraint "conversation_participants_conversation_id_fkey";

alter table "public"."conversation_participants" add constraint "conversation_participants_conversation_id_user_id_key" UNIQUE using index "conversation_participants_conversation_id_user_id_key";

alter table "public"."conversation_participants" add constraint "conversation_participants_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."conversation_participants" validate constraint "conversation_participants_user_id_fkey";

alter table "public"."interpreter_exchanges" add constraint "interpreter_exchanges_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.interpreter_sessions(id) ON DELETE CASCADE not valid;

alter table "public"."interpreter_exchanges" validate constraint "interpreter_exchanges_session_id_fkey";

alter table "public"."interpreter_exchanges" add constraint "interpreter_exchanges_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."interpreter_exchanges" validate constraint "interpreter_exchanges_user_id_fkey";

alter table "public"."interpreter_sessions" add constraint "interpreter_sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."interpreter_sessions" validate constraint "interpreter_sessions_user_id_fkey";

alter table "public"."message_scaled_texts" add constraint "message_scaled_texts_message_id_fkey" FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE not valid;

alter table "public"."message_scaled_texts" validate constraint "message_scaled_texts_message_id_fkey";

alter table "public"."message_scaled_texts" add constraint "message_scaled_texts_target_proficiency_check" CHECK ((target_proficiency = ANY (ARRAY['beginner'::text, 'intermediate'::text, 'advanced'::text]))) not valid;

alter table "public"."message_scaled_texts" validate constraint "message_scaled_texts_target_proficiency_check";

alter table "public"."message_status" add constraint "message_status_message_id_fkey" FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE not valid;

alter table "public"."message_status" validate constraint "message_status_message_id_fkey";

alter table "public"."message_status" add constraint "message_status_message_id_user_id_key" UNIQUE using index "message_status_message_id_user_id_key";

alter table "public"."message_status" add constraint "message_status_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."message_status" validate constraint "message_status_user_id_fkey";

alter table "public"."message_translations" add constraint "message_translations_message_id_fkey" FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE not valid;

alter table "public"."message_translations" validate constraint "message_translations_message_id_fkey";

alter table "public"."message_translations" add constraint "message_translations_message_id_target_language_key" UNIQUE using index "message_translations_message_id_target_language_key";

alter table "public"."messages" add constraint "messages_content_type_check" CHECK (((content_type)::text = 'text'::text)) not valid;

alter table "public"."messages" validate constraint "messages_content_type_check";

alter table "public"."messages" add constraint "messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE not valid;

alter table "public"."messages" validate constraint "messages_conversation_id_fkey";

alter table "public"."messages" add constraint "messages_deleted_for_everyone_by_fkey" FOREIGN KEY (deleted_for_everyone_by) REFERENCES public.profiles(id) not valid;

alter table "public"."messages" validate constraint "messages_deleted_for_everyone_by_fkey";

alter table "public"."messages" add constraint "messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."messages" validate constraint "messages_sender_id_fkey";

alter table "public"."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) not valid;

alter table "public"."profiles" validate constraint "profiles_id_fkey";

alter table "public"."profiles" add constraint "profiles_language_proficiency_check" CHECK ((language_proficiency = ANY (ARRAY['beginner'::text, 'intermediate'::text, 'advanced'::text]))) not valid;

alter table "public"."profiles" validate constraint "profiles_language_proficiency_check";

alter table "public"."profiles" add constraint "profiles_phone_number_key" UNIQUE using index "profiles_phone_number_key";

alter table "public"."profiles" add constraint "profiles_username_key" UNIQUE using index "profiles_username_key";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_conversation_participants_secure(conv_id uuid)
 RETURNS TABLE(id uuid, conversation_id uuid, user_id uuid, is_admin boolean, hidden_at timestamp with time zone, cleared_at timestamp with time zone, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Security check: caller must be a participant in this conversation
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = conv_id 
    AND cp.user_id = auth.uid()
  ) THEN
    -- Return empty result if not authorized
    RETURN;
  END IF;
  
  -- Return all participants (caller is verified as member)
  RETURN QUERY
  SELECT 
    cp.id,
    cp.conversation_id,
    cp.user_id,
    cp.is_admin,
    cp.hidden_at,
    cp.cleared_at,
    cp.joined_at
  FROM conversation_participants cp
  WHERE cp.conversation_id = conv_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, language_preference)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'language_preference', 'en')
  );
  RETURN NEW;
END;
$function$
;

grant delete on table "public"."ai_chat_messages" to "anon";

grant insert on table "public"."ai_chat_messages" to "anon";

grant references on table "public"."ai_chat_messages" to "anon";

grant select on table "public"."ai_chat_messages" to "anon";

grant trigger on table "public"."ai_chat_messages" to "anon";

grant truncate on table "public"."ai_chat_messages" to "anon";

grant update on table "public"."ai_chat_messages" to "anon";

grant delete on table "public"."ai_chat_messages" to "authenticated";

grant insert on table "public"."ai_chat_messages" to "authenticated";

grant references on table "public"."ai_chat_messages" to "authenticated";

grant select on table "public"."ai_chat_messages" to "authenticated";

grant trigger on table "public"."ai_chat_messages" to "authenticated";

grant truncate on table "public"."ai_chat_messages" to "authenticated";

grant update on table "public"."ai_chat_messages" to "authenticated";

grant delete on table "public"."ai_chat_messages" to "service_role";

grant insert on table "public"."ai_chat_messages" to "service_role";

grant references on table "public"."ai_chat_messages" to "service_role";

grant select on table "public"."ai_chat_messages" to "service_role";

grant trigger on table "public"."ai_chat_messages" to "service_role";

grant truncate on table "public"."ai_chat_messages" to "service_role";

grant update on table "public"."ai_chat_messages" to "service_role";

grant delete on table "public"."ai_chat_sessions" to "anon";

grant insert on table "public"."ai_chat_sessions" to "anon";

grant references on table "public"."ai_chat_sessions" to "anon";

grant select on table "public"."ai_chat_sessions" to "anon";

grant trigger on table "public"."ai_chat_sessions" to "anon";

grant truncate on table "public"."ai_chat_sessions" to "anon";

grant update on table "public"."ai_chat_sessions" to "anon";

grant delete on table "public"."ai_chat_sessions" to "authenticated";

grant insert on table "public"."ai_chat_sessions" to "authenticated";

grant references on table "public"."ai_chat_sessions" to "authenticated";

grant select on table "public"."ai_chat_sessions" to "authenticated";

grant trigger on table "public"."ai_chat_sessions" to "authenticated";

grant truncate on table "public"."ai_chat_sessions" to "authenticated";

grant update on table "public"."ai_chat_sessions" to "authenticated";

grant delete on table "public"."ai_chat_sessions" to "service_role";

grant insert on table "public"."ai_chat_sessions" to "service_role";

grant references on table "public"."ai_chat_sessions" to "service_role";

grant select on table "public"."ai_chat_sessions" to "service_role";

grant trigger on table "public"."ai_chat_sessions" to "service_role";

grant truncate on table "public"."ai_chat_sessions" to "service_role";

grant update on table "public"."ai_chat_sessions" to "service_role";

grant delete on table "public"."conversation_participants" to "anon";

grant insert on table "public"."conversation_participants" to "anon";

grant references on table "public"."conversation_participants" to "anon";

grant select on table "public"."conversation_participants" to "anon";

grant trigger on table "public"."conversation_participants" to "anon";

grant truncate on table "public"."conversation_participants" to "anon";

grant update on table "public"."conversation_participants" to "anon";

grant delete on table "public"."conversation_participants" to "authenticated";

grant insert on table "public"."conversation_participants" to "authenticated";

grant references on table "public"."conversation_participants" to "authenticated";

grant select on table "public"."conversation_participants" to "authenticated";

grant trigger on table "public"."conversation_participants" to "authenticated";

grant truncate on table "public"."conversation_participants" to "authenticated";

grant update on table "public"."conversation_participants" to "authenticated";

grant delete on table "public"."conversation_participants" to "service_role";

grant insert on table "public"."conversation_participants" to "service_role";

grant references on table "public"."conversation_participants" to "service_role";

grant select on table "public"."conversation_participants" to "service_role";

grant trigger on table "public"."conversation_participants" to "service_role";

grant truncate on table "public"."conversation_participants" to "service_role";

grant update on table "public"."conversation_participants" to "service_role";

grant delete on table "public"."conversations" to "anon";

grant insert on table "public"."conversations" to "anon";

grant references on table "public"."conversations" to "anon";

grant select on table "public"."conversations" to "anon";

grant trigger on table "public"."conversations" to "anon";

grant truncate on table "public"."conversations" to "anon";

grant update on table "public"."conversations" to "anon";

grant delete on table "public"."conversations" to "authenticated";

grant insert on table "public"."conversations" to "authenticated";

grant references on table "public"."conversations" to "authenticated";

grant select on table "public"."conversations" to "authenticated";

grant trigger on table "public"."conversations" to "authenticated";

grant truncate on table "public"."conversations" to "authenticated";

grant update on table "public"."conversations" to "authenticated";

grant delete on table "public"."conversations" to "service_role";

grant insert on table "public"."conversations" to "service_role";

grant references on table "public"."conversations" to "service_role";

grant select on table "public"."conversations" to "service_role";

grant trigger on table "public"."conversations" to "service_role";

grant truncate on table "public"."conversations" to "service_role";

grant update on table "public"."conversations" to "service_role";

grant delete on table "public"."interpreter_exchanges" to "anon";

grant insert on table "public"."interpreter_exchanges" to "anon";

grant references on table "public"."interpreter_exchanges" to "anon";

grant select on table "public"."interpreter_exchanges" to "anon";

grant trigger on table "public"."interpreter_exchanges" to "anon";

grant truncate on table "public"."interpreter_exchanges" to "anon";

grant update on table "public"."interpreter_exchanges" to "anon";

grant delete on table "public"."interpreter_exchanges" to "authenticated";

grant insert on table "public"."interpreter_exchanges" to "authenticated";

grant references on table "public"."interpreter_exchanges" to "authenticated";

grant select on table "public"."interpreter_exchanges" to "authenticated";

grant trigger on table "public"."interpreter_exchanges" to "authenticated";

grant truncate on table "public"."interpreter_exchanges" to "authenticated";

grant update on table "public"."interpreter_exchanges" to "authenticated";

grant delete on table "public"."interpreter_exchanges" to "service_role";

grant insert on table "public"."interpreter_exchanges" to "service_role";

grant references on table "public"."interpreter_exchanges" to "service_role";

grant select on table "public"."interpreter_exchanges" to "service_role";

grant trigger on table "public"."interpreter_exchanges" to "service_role";

grant truncate on table "public"."interpreter_exchanges" to "service_role";

grant update on table "public"."interpreter_exchanges" to "service_role";

grant delete on table "public"."interpreter_sessions" to "anon";

grant insert on table "public"."interpreter_sessions" to "anon";

grant references on table "public"."interpreter_sessions" to "anon";

grant select on table "public"."interpreter_sessions" to "anon";

grant trigger on table "public"."interpreter_sessions" to "anon";

grant truncate on table "public"."interpreter_sessions" to "anon";

grant update on table "public"."interpreter_sessions" to "anon";

grant delete on table "public"."interpreter_sessions" to "authenticated";

grant insert on table "public"."interpreter_sessions" to "authenticated";

grant references on table "public"."interpreter_sessions" to "authenticated";

grant select on table "public"."interpreter_sessions" to "authenticated";

grant trigger on table "public"."interpreter_sessions" to "authenticated";

grant truncate on table "public"."interpreter_sessions" to "authenticated";

grant update on table "public"."interpreter_sessions" to "authenticated";

grant delete on table "public"."interpreter_sessions" to "service_role";

grant insert on table "public"."interpreter_sessions" to "service_role";

grant references on table "public"."interpreter_sessions" to "service_role";

grant select on table "public"."interpreter_sessions" to "service_role";

grant trigger on table "public"."interpreter_sessions" to "service_role";

grant truncate on table "public"."interpreter_sessions" to "service_role";

grant update on table "public"."interpreter_sessions" to "service_role";

grant delete on table "public"."message_scaled_texts" to "anon";

grant insert on table "public"."message_scaled_texts" to "anon";

grant references on table "public"."message_scaled_texts" to "anon";

grant select on table "public"."message_scaled_texts" to "anon";

grant trigger on table "public"."message_scaled_texts" to "anon";

grant truncate on table "public"."message_scaled_texts" to "anon";

grant update on table "public"."message_scaled_texts" to "anon";

grant delete on table "public"."message_scaled_texts" to "authenticated";

grant insert on table "public"."message_scaled_texts" to "authenticated";

grant references on table "public"."message_scaled_texts" to "authenticated";

grant select on table "public"."message_scaled_texts" to "authenticated";

grant trigger on table "public"."message_scaled_texts" to "authenticated";

grant truncate on table "public"."message_scaled_texts" to "authenticated";

grant update on table "public"."message_scaled_texts" to "authenticated";

grant delete on table "public"."message_scaled_texts" to "service_role";

grant insert on table "public"."message_scaled_texts" to "service_role";

grant references on table "public"."message_scaled_texts" to "service_role";

grant select on table "public"."message_scaled_texts" to "service_role";

grant trigger on table "public"."message_scaled_texts" to "service_role";

grant truncate on table "public"."message_scaled_texts" to "service_role";

grant update on table "public"."message_scaled_texts" to "service_role";

grant delete on table "public"."message_status" to "anon";

grant insert on table "public"."message_status" to "anon";

grant references on table "public"."message_status" to "anon";

grant select on table "public"."message_status" to "anon";

grant trigger on table "public"."message_status" to "anon";

grant truncate on table "public"."message_status" to "anon";

grant update on table "public"."message_status" to "anon";

grant delete on table "public"."message_status" to "authenticated";

grant insert on table "public"."message_status" to "authenticated";

grant references on table "public"."message_status" to "authenticated";

grant select on table "public"."message_status" to "authenticated";

grant trigger on table "public"."message_status" to "authenticated";

grant truncate on table "public"."message_status" to "authenticated";

grant update on table "public"."message_status" to "authenticated";

grant delete on table "public"."message_status" to "service_role";

grant insert on table "public"."message_status" to "service_role";

grant references on table "public"."message_status" to "service_role";

grant select on table "public"."message_status" to "service_role";

grant trigger on table "public"."message_status" to "service_role";

grant truncate on table "public"."message_status" to "service_role";

grant update on table "public"."message_status" to "service_role";

grant delete on table "public"."message_translations" to "anon";

grant insert on table "public"."message_translations" to "anon";

grant references on table "public"."message_translations" to "anon";

grant select on table "public"."message_translations" to "anon";

grant trigger on table "public"."message_translations" to "anon";

grant truncate on table "public"."message_translations" to "anon";

grant update on table "public"."message_translations" to "anon";

grant delete on table "public"."message_translations" to "authenticated";

grant insert on table "public"."message_translations" to "authenticated";

grant references on table "public"."message_translations" to "authenticated";

grant select on table "public"."message_translations" to "authenticated";

grant trigger on table "public"."message_translations" to "authenticated";

grant truncate on table "public"."message_translations" to "authenticated";

grant update on table "public"."message_translations" to "authenticated";

grant delete on table "public"."message_translations" to "service_role";

grant insert on table "public"."message_translations" to "service_role";

grant references on table "public"."message_translations" to "service_role";

grant select on table "public"."message_translations" to "service_role";

grant trigger on table "public"."message_translations" to "service_role";

grant truncate on table "public"."message_translations" to "service_role";

grant update on table "public"."message_translations" to "service_role";

grant delete on table "public"."messages" to "anon";

grant insert on table "public"."messages" to "anon";

grant references on table "public"."messages" to "anon";

grant select on table "public"."messages" to "anon";

grant trigger on table "public"."messages" to "anon";

grant truncate on table "public"."messages" to "anon";

grant update on table "public"."messages" to "anon";

grant delete on table "public"."messages" to "authenticated";

grant insert on table "public"."messages" to "authenticated";

grant references on table "public"."messages" to "authenticated";

grant select on table "public"."messages" to "authenticated";

grant trigger on table "public"."messages" to "authenticated";

grant truncate on table "public"."messages" to "authenticated";

grant update on table "public"."messages" to "authenticated";

grant delete on table "public"."messages" to "service_role";

grant insert on table "public"."messages" to "service_role";

grant references on table "public"."messages" to "service_role";

grant select on table "public"."messages" to "service_role";

grant trigger on table "public"."messages" to "service_role";

grant truncate on table "public"."messages" to "service_role";

grant update on table "public"."messages" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";


  create policy "ai_chat_messages_insert"
  on "public"."ai_chat_messages"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.ai_chat_sessions s
  WHERE ((s.id = ai_chat_messages.session_id) AND (s.user_id = auth.uid())))));



  create policy "ai_chat_messages_select"
  on "public"."ai_chat_messages"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.ai_chat_sessions s
  WHERE ((s.id = ai_chat_messages.session_id) AND (s.user_id = auth.uid())))));



  create policy "ai_chat_sessions_delete"
  on "public"."ai_chat_sessions"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "ai_chat_sessions_insert"
  on "public"."ai_chat_sessions"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "ai_chat_sessions_select"
  on "public"."ai_chat_sessions"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "ai_chat_sessions_update"
  on "public"."ai_chat_sessions"
  as permissive
  for update
  to public
using ((auth.uid() = user_id));



  create policy "Users can add participants"
  on "public"."conversation_participants"
  as permissive
  for insert
  to public
with check (true);



  create policy "Users can delete their own participation"
  on "public"."conversation_participants"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "Users can leave or admins can remove"
  on "public"."conversation_participants"
  as permissive
  for delete
  to public
using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.conversation_participants cp
  WHERE ((cp.conversation_id = conversation_participants.conversation_id) AND (cp.user_id = auth.uid()) AND (cp.is_admin = true))))));



  create policy "Users can view their own participation"
  on "public"."conversation_participants"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "participants_insert"
  on "public"."conversation_participants"
  as permissive
  for insert
  to public
with check ((auth.uid() IS NOT NULL));



  create policy "participants_select"
  on "public"."conversation_participants"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "participants_update"
  on "public"."conversation_participants"
  as permissive
  for update
  to public
using ((user_id = auth.uid()));



  create policy "Group admins can update conversations"
  on "public"."conversations"
  as permissive
  for update
  to public
using (((is_group = true) AND (EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = conversations.id) AND (conversation_participants.user_id = auth.uid()) AND (conversation_participants.is_admin = true))))));



  create policy "Participants can update conversation timestamp"
  on "public"."conversations"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = conversation_participants.id) AND (conversation_participants.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = conversation_participants.id) AND (conversation_participants.user_id = auth.uid())))));



  create policy "Users can view own conversations"
  on "public"."conversations"
  as permissive
  for select
  to public
using (((EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = conversations.id) AND (conversation_participants.user_id = auth.uid())))) OR (created_at > (now() - '00:00:10'::interval))));



  create policy "conversations_insert"
  on "public"."conversations"
  as permissive
  for insert
  to public
with check ((auth.uid() IS NOT NULL));



  create policy "conversations_select"
  on "public"."conversations"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = conversations.id) AND (conversation_participants.user_id = auth.uid())))));



  create policy "conversations_update"
  on "public"."conversations"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = conversations.id) AND (conversation_participants.user_id = auth.uid())))));



  create policy "Users can create interpreter exchanges"
  on "public"."interpreter_exchanges"
  as permissive
  for insert
  to public
with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.interpreter_sessions
  WHERE ((interpreter_sessions.id = interpreter_exchanges.session_id) AND (interpreter_sessions.user_id = auth.uid()))))));



  create policy "Users can view own interpreter exchanges"
  on "public"."interpreter_exchanges"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.interpreter_sessions
  WHERE ((interpreter_sessions.id = interpreter_exchanges.session_id) AND (interpreter_sessions.user_id = auth.uid())))));



  create policy "Users can create own interpreter sessions"
  on "public"."interpreter_sessions"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "Users can delete own interpreter sessions"
  on "public"."interpreter_sessions"
  as permissive
  for delete
  to public
using ((user_id = auth.uid()));



  create policy "Users can update own interpreter sessions"
  on "public"."interpreter_sessions"
  as permissive
  for update
  to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));



  create policy "Users can view own interpreter sessions"
  on "public"."interpreter_sessions"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "scaled_texts_insert"
  on "public"."message_scaled_texts"
  as permissive
  for insert
  to public
with check (true);



  create policy "scaled_texts_select"
  on "public"."message_scaled_texts"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.messages m
     JOIN public.conversation_participants cp ON ((cp.conversation_id = m.conversation_id)))
  WHERE ((m.id = message_scaled_texts.message_id) AND (cp.user_id = auth.uid())))));



  create policy "Users can update own message status"
  on "public"."message_status"
  as permissive
  for update
  to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));



  create policy "Users can update status for received messages"
  on "public"."message_status"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "Users can view status of sent messages"
  on "public"."message_status"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.messages
  WHERE ((messages.id = message_status.message_id) AND (messages.sender_id = auth.uid())))));



  create policy "Service role can insert translations"
  on "public"."message_translations"
  as permissive
  for insert
  to public
with check (true);



  create policy "Users can view translations"
  on "public"."message_translations"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.messages
     JOIN public.conversation_participants ON ((conversation_participants.conversation_id = messages.conversation_id)))
  WHERE ((messages.id = message_translations.message_id) AND (conversation_participants.user_id = auth.uid()) AND (messages.deleted_for_everyone_by IS NULL) AND (NOT (auth.uid() = ANY (messages.deleted_for_users)))))));



  create policy "translations_insert"
  on "public"."message_translations"
  as permissive
  for insert
  to public
with check (true);



  create policy "translations_select"
  on "public"."message_translations"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.messages m
     JOIN public.conversation_participants cp ON ((cp.conversation_id = m.conversation_id)))
  WHERE ((m.id = message_translations.message_id) AND (cp.user_id = auth.uid())))));



  create policy "Users can send messages to own conversations"
  on "public"."messages"
  as permissive
  for insert
  to public
with check (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = messages.conversation_id) AND (conversation_participants.user_id = auth.uid()))))));



  create policy "Users can update own messages"
  on "public"."messages"
  as permissive
  for update
  to public
using ((sender_id = auth.uid()))
with check ((sender_id = auth.uid()));



  create policy "Users can view messages in own conversations"
  on "public"."messages"
  as permissive
  for select
  to public
using (((EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = messages.conversation_id) AND (conversation_participants.user_id = auth.uid())))) AND (deleted_for_everyone_by IS NULL) AND (NOT (auth.uid() = ANY (deleted_for_users)))));



  create policy "messages_insert"
  on "public"."messages"
  as permissive
  for insert
  to public
with check (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = messages.conversation_id) AND (conversation_participants.user_id = auth.uid()))))));



  create policy "messages_select"
  on "public"."messages"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.conversation_participants
  WHERE ((conversation_participants.conversation_id = messages.conversation_id) AND (conversation_participants.user_id = auth.uid())))));



  create policy "Anyone can view profiles"
  on "public"."profiles"
  as permissive
  for select
  to public
using (true);



  create policy "Users can insert own profile"
  on "public"."profiles"
  as permissive
  for insert
  to public
with check ((auth.uid() = id));



  create policy "Users can update own profile"
  on "public"."profiles"
  as permissive
  for update
  to public
using ((auth.uid() = id))
with check ((auth.uid() = id));



  create policy "profiles_insert"
  on "public"."profiles"
  as permissive
  for insert
  to public
with check ((auth.uid() = id));



  create policy "profiles_select"
  on "public"."profiles"
  as permissive
  for select
  to public
using (true);



  create policy "profiles_update"
  on "public"."profiles"
  as permissive
  for update
  to public
using ((auth.uid() = id));


CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Anyone can view avatars 1oj01fe_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));



  create policy "Avatars are publicly viewable"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));



  create policy "Users can delete own avatars 1oj01fe_0"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete own images 1ffg0oo_0"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'images'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete own interpreter audio a8bikj_0"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'interpreter-audio'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete own videos 1livt5k_0"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'videos'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete own voice messages 16ecuiv_0"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'voice-messages'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can update own avatars 1oj01fe_0"
  on "storage"."objects"
  as permissive
  for update
  to public
using (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can update their own avatar"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can upload avatars 1oj01fe_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'avatars'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Users can upload images 1ffg0oo_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'images'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Users can upload interpreter audio a8bikj_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'interpreter-audio'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Users can upload their own avatar"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can upload videos 1livt5k_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'videos'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Users can upload voice messages 16ecuiv_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'voice-messages'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Users can view images 1ffg0oo_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'images'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Users can view interpreter audio a8bikj_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'interpreter-audio'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Users can view videos 1livt5k_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'videos'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Users can view voice messages 16ecuiv_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'voice-messages'::text) AND (auth.role() = 'authenticated'::text)));



