-- Preserve all existing rows, ownership policies, quotas and legacy tables.
begin;
alter table public.nuelexity_conversations
  add column selected_model text check (selected_model is null or char_length(selected_model) between 1 and 100);
alter table public.nuelexity_messages
  add column model jsonb check (model is null or (
    jsonb_typeof(model) = 'object' and
    model ?& array['id', 'name', 'provider', 'preview'] and
    jsonb_typeof(model->'id') = 'string' and
    jsonb_typeof(model->'name') = 'string' and
    model->>'provider' = 'Groq' and
    jsonb_typeof(model->'preview') = 'boolean' and
    role = 'assistant' and status = 'complete'
  )),
  add column answer_kind text check (answer_kind is null or answer_kind in ('ai', 'sources-only', 'no-sources')),
  add constraint nuelexity_message_model_kind check (model is null or (answer_kind is not null and answer_kind = 'ai'));
-- NULL on old messages means unknown, never today's default model.
notify pgrst, 'reload schema';
commit;
