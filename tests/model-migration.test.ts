import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const model = { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", provider: "Groq", preview: true };
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${owner}'), ('${other}');`);
  await db.exec(await Bun.file(new URL("../supabase/migrations/202610050001_research_foundation.sql", import.meta.url)).text());
  await db.exec(`insert into public.nuelexity_conversations(id,user_id,title) values ('${id}','${owner}','Preserved');
    insert into public.nuelexity_messages(conversation_id,user_id,role,content) values ('${id}','${owner}','assistant','Old answer');`);
  await db.exec(await Bun.file(new URL("../supabase/migrations/202610140001_model_selection.sql", import.meta.url)).text());
  await db.exec(await Bun.file(new URL("../supabase/verification/202610140001_model_selection.sql", import.meta.url)).text());
}, 20000);
afterAll(async () => { await db.close(); });

test("additive migration preserves old content with unknown attribution and no invented selection", async () => {
  const old = await db.query<any>("select content,model,answer_kind from public.nuelexity_messages where content='Old answer'");
  expect(old.rows[0]).toEqual({ content: "Old answer", model: null, answer_kind: null });
  const thread = await db.query<any>("select selected_model from public.nuelexity_conversations where id=$1", [id]);
  expect(thread.rows[0]?.selected_model).toBeNull();
});
test("server writes persist conversation choice and successful assistant attribution", async () => {
  await db.query("update public.nuelexity_conversations set selected_model=$1 where id=$2 and user_id=$3", [model.id, id, owner]);
  await db.query("insert into public.nuelexity_messages(conversation_id,user_id,role,content,model,answer_kind) values ($1,$2,'assistant','New answer',$3,'ai')", [id, owner, JSON.stringify(model)]);
  const rows = await db.query<any>("select c.selected_model,m.model from public.nuelexity_conversations c join public.nuelexity_messages m on m.conversation_id=c.id where m.content='New answer'");
  expect(rows.rows[0]).toEqual({ selected_model: model.id, model });
});
test("model metadata is rejected for user/failed turns or without a truthful generation kind", async () => {
  for (const [role, status, kind] of [["user", "complete", "ai"], ["assistant", "failed", "ai"], ["assistant", "complete", null], ["assistant", "complete", "sources-only"]])
    await expect(db.query("insert into public.nuelexity_messages(conversation_id,user_id,role,content,status,model,answer_kind) values ($1,$2,$3,'Invalid',$4,$5,$6)", [id, owner, role, status, JSON.stringify(model), kind])).rejects.toThrow();
});
test("new columns inherit ownership RLS and remain unwritable by the browser", async () => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`);
  expect((await db.query("select selected_model from public.nuelexity_conversations")).rows).toHaveLength(0);
  expect((await db.query("select model from public.nuelexity_messages")).rows).toHaveLength(0);
  await expect(db.query("update public.nuelexity_conversations set selected_model='x'")).rejects.toThrow();
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  expect((await db.query("select selected_model from public.nuelexity_conversations")).rows).toHaveLength(1);
  await db.exec("reset role");
});
