-- Final schema supplied by the owner: enums from migration 1, tables from migration 2.
-- No historical DROP statements are necessary when setting up this empty test database.
create type public.auth_provider as enum ('GOOGLE', 'GITHUB');
create type public.message_role as enum ('USER', 'ASSISTANT');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  provider public.auth_provider not null,
  name text not null
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null,
  user_id uuid not null references public.users(id) on delete cascade
);

create table public.messages (
  id bigint generated always as identity primary key,
  content text not null,
  role public.message_role not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now()
);
