-- OPTIONAL MANUAL MAINTENANCE, not an automatically applied migration.
-- The owner confirmed the legacy app had no users/history. Still check before deleting sha.
-- Never use CASCADE here: unexpected dependencies must stop the whole transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $$
declare
  v_table text;
  v_has_rows boolean;
begin
  -- A custom Auth trigger may provision legacy public.users without a tracked SQL dependency.
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and not tgisinternal
  ) then
    raise exception 'Cleanup stopped: review custom auth.users triggers before removing legacy tables.';
  end if;
  foreach v_table in array array['messages', 'conversations', 'users'] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('lock table public.%I in access exclusive mode', v_table);
      execute format('select exists (select 1 from public.%I)', v_table) into v_has_rows;
      if v_has_rows then
        raise exception 'Cleanup stopped: public.% contains rows; nothing will be removed.', v_table;
      end if;
    end if;
  end loop;
end;
$$;

drop table if exists public.messages;
drop table if exists public.conversations;
drop table if exists public.users;
drop type if exists public.message_role;
drop type if exists public.auth_provider;
commit;
