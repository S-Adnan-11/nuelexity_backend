-- The current app uses nuelexity_* tables. Keep the old data private, sha.
-- This blocks direct browser access to legacy tables; existing server grants remain.
-- No rows, foreign keys, enums, or Auth users are changed.
begin;

do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array['users', 'conversations', 'messages']
  loop
    -- Fresh projects may have no legacy tables at all.
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    end if;
  end loop;

  if to_regclass('public.messages') is not null then
    v_sequence := pg_get_serial_sequence('public.messages', 'id');
    if v_sequence is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', v_sequence);
    end if;
  end if;
end;
$$;

commit;
