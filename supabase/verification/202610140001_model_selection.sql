-- Read-only verification after applying the model-selection migration.
-- No message content, user IDs, secrets, or conversations are returned.
begin read only;
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and (
  (table_name = 'nuelexity_conversations' and column_name = 'selected_model') or
  (table_name = 'nuelexity_messages' and column_name in ('model', 'answer_kind'))
)
order by table_name, column_name;
-- Expect three nullable columns: selected_model/text, model/jsonb, answer_kind/text.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.nuelexity_messages'::regclass
  and conname in ('nuelexity_messages_model_check', 'nuelexity_messages_answer_kind_check', 'nuelexity_message_model_kind')
order by conname;
-- Expect three constraints, including successful assistant-only attribution.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where oid in ('public.nuelexity_conversations'::regclass, 'public.nuelexity_messages'::regclass);
-- Expect RLS true for both tables.
select
  has_table_privilege('authenticated', 'public.nuelexity_conversations', 'UPDATE') as browser_can_update_selection,
  has_table_privilege('authenticated', 'public.nuelexity_messages', 'INSERT') as browser_can_insert_attribution;
-- Expect false, false. Mutations go through verified server ownership checks.
commit;
