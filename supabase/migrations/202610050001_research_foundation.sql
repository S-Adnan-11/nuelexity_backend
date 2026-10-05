-- Additive foundation: legacy/manual tables are deliberately untouched.
begin;

create table public.nuelexity_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index nuelexity_conversations_owner_updated on public.nuelexity_conversations (user_id, updated_at desc, id desc);

create table public.nuelexity_messages (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  conversation_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 5),
  follow_ups jsonb not null default '[]'::jsonb check (jsonb_typeof(follow_ups) = 'array' and jsonb_array_length(follow_ups) <= 3),
  status text not null default 'complete' check (status in ('complete', 'failed')),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.nuelexity_conversations(id, user_id) on delete cascade
);
create index nuelexity_messages_thread_sequence on public.nuelexity_messages (conversation_id, sequence);
create index nuelexity_messages_owner on public.nuelexity_messages (user_id);

create table public.nuelexity_usage (
  subject text not null,
  bucket text not null check (bucket in ('day', 'month', 'minute')),
  period_start timestamptz not null,
  requests integer not null default 0 check (requests >= 0),
  primary key (subject, bucket, period_start)
);
create index nuelexity_usage_cleanup on public.nuelexity_usage (period_start);
create table public.nuelexity_leases (
  subject text primary key,
  request_id uuid not null,
  active_until timestamptz not null
);

alter table public.nuelexity_conversations enable row level security;
alter table public.nuelexity_messages enable row level security;
alter table public.nuelexity_usage enable row level security;
alter table public.nuelexity_leases enable row level security;
-- Browsers can only read their own history; all mutations go through the API.
create policy nuelexity_read_own_conversations on public.nuelexity_conversations for select to authenticated using ((select auth.uid()) = user_id);
create policy nuelexity_read_own_messages on public.nuelexity_messages for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.nuelexity_conversations, public.nuelexity_messages, public.nuelexity_usage, public.nuelexity_leases from public, anon, authenticated;
grant select on public.nuelexity_conversations, public.nuelexity_messages to authenticated;
grant all on public.nuelexity_conversations, public.nuelexity_messages, public.nuelexity_usage, public.nuelexity_leases to service_role;
revoke all on sequence public.nuelexity_messages_sequence_seq from public, anon, authenticated;
grant usage, select on sequence public.nuelexity_messages_sequence_seq to service_role;

create function public.nuelexity_touch_conversation() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.nuelexity_conversations set updated_at = clock_timestamp() where id = new.conversation_id;
  return new;
end;
$$;
create trigger nuelexity_message_touch after insert on public.nuelexity_messages for each row execute function public.nuelexity_touch_conversation();
revoke all on function public.nuelexity_touch_conversation() from public, anon, authenticated;

create function public.nuelexity_reserve_request(
  p_subject text, p_ip_hash text, p_request_id uuid,
  p_daily_limit integer, p_ip_limit integer,
  p_global_daily integer, p_global_monthly integer, p_global_minute integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_day timestamptz := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  v_month timestamptz := date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC';
  v_minute timestamptz := date_trunc('minute', v_now);
  v_counter record;
  v_used integer;
  v_remaining integer;
  v_subject text;
begin
  if p_subject is null or p_ip_hash is null or p_request_id is null
     or char_length(p_subject) > 100 or p_subject !~ '^(user:|guest:)'
     or p_ip_hash !~ '^[a-f0-9]{64}$'
     or p_daily_limit is null or p_daily_limit not between 1 and 50
     or p_ip_limit is null or p_ip_limit not between 1 and 100
     or p_global_daily is null or p_global_daily not between 1 and 1000
     or p_global_monthly is null or p_global_monthly not between 1 and 1000
     or p_global_minute is null or p_global_minute not between 1 and 30 then
    raise exception 'Invalid quota configuration';
  end if;

  -- One transaction lock serializes all budget checks across backend instances.
  -- No free-quota wahala when two requests land at the same time sha 😹.
  perform pg_advisory_xact_lock(53002);
  if exists (select 1 from public.nuelexity_leases where subject = p_subject and active_until > v_now) then
    return jsonb_build_object('allowed', false, 'code', 'REQUEST_IN_PROGRESS', 'retryAfter', 75);
  end if;

  for v_counter in
    select * from (values
      (p_subject, 'day', v_day, p_daily_limit, 'DAILY_LIMIT', extract(epoch from v_day + interval '1 day' - v_now)::integer + 1),
      ('ip:' || p_ip_hash, 'day', v_day, p_ip_limit, 'IP_DAILY_LIMIT', extract(epoch from v_day + interval '1 day' - v_now)::integer + 1),
      ('global', 'day', v_day, p_global_daily, 'GLOBAL_DAILY_LIMIT', extract(epoch from v_day + interval '1 day' - v_now)::integer + 1),
      ('global', 'month', v_month, p_global_monthly, 'GLOBAL_MONTHLY_LIMIT', extract(epoch from v_month + interval '1 month' - v_now)::integer + 1),
      ('global', 'minute', v_minute, p_global_minute, 'GLOBAL_MINUTE_LIMIT', 60)
    ) as limits(subject, bucket, period_start, ceiling, code, retry_after)
  loop
    select requests into v_used from public.nuelexity_usage
      where subject = v_counter.subject and bucket = v_counter.bucket and period_start = v_counter.period_start;
    if coalesce(v_used, 0) >= v_counter.ceiling then
      return jsonb_build_object('allowed', false, 'code', v_counter.code, 'retryAfter', v_counter.retry_after);
    end if;
  end loop;

  insert into public.nuelexity_usage(subject, bucket, period_start, requests) values
    (p_subject, 'day', v_day, 1), ('ip:' || p_ip_hash, 'day', v_day, 1),
    ('global', 'day', v_day, 1), ('global', 'month', v_month, 1), ('global', 'minute', v_minute, 1)
  on conflict (subject, bucket, period_start) do update set requests = public.nuelexity_usage.requests + 1;
  insert into public.nuelexity_leases(subject, request_id, active_until) values (p_subject, p_request_id, v_now + interval '75 seconds')
  on conflict (subject) do update set request_id = excluded.request_id, active_until = excluded.active_until;

  select p_daily_limit - requests into v_remaining from public.nuelexity_usage
    where subject = p_subject and bucket = 'day' and period_start = v_day;
  -- Counters older than two months cannot affect any current budget.
  delete from public.nuelexity_usage where period_start < v_day - interval '62 days'
    or (bucket = 'minute' and period_start < v_minute - interval '1 day');
  delete from public.nuelexity_leases where active_until < v_now - interval '1 day';
  return jsonb_build_object('allowed', true, 'remaining', v_remaining);
end;
$$;

create function public.nuelexity_release_request(p_subject text, p_request_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.nuelexity_leases where subject = p_subject and request_id = p_request_id;
$$;
revoke all on function public.nuelexity_reserve_request(text, text, uuid, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.nuelexity_release_request(text, uuid) from public, anon, authenticated;
grant execute on function public.nuelexity_reserve_request(text, text, uuid, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.nuelexity_release_request(text, uuid) to service_role;

commit;
