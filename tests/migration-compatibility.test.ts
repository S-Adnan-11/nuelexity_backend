import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const authOnlyUser = "22222222-2222-4222-8222-222222222222";
const legacyThread = "33333333-3333-4333-8333-333333333333";
let originalRows: Record<string, unknown>[];

async function runSql(path: string) {
  await db.exec(await Bun.file(new URL(path, import.meta.url)).text());
}

async function legacyRows() {
  return (
    await db.query<Record<string, unknown>>(`
      select 'users' as table_name, to_jsonb(u) as row from public.users u
      union all select 'conversations', to_jsonb(c) from public.conversations c
      union all select 'messages', to_jsonb(m) from public.messages m
      order by table_name
    `)
  ).rows;
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${owner}'), ('${authOnlyUser}');
  `);
  await runSql("./fixtures/legacy-schema.sql");
  await db.exec(`
    insert into public.users values ('${owner}', 'owner@example.test', 'GOOGLE', 'Test owner');
    insert into public.conversations(id, title, slug, user_id)
      values ('${legacyThread}', 'Existing research', 'existing-research', '${owner}');
    insert into public.messages(content, role, conversation_id, created_at)
      values ('Keep this old message', 'USER', '${legacyThread}', '2026-09-01T00:00:00Z');
    grant all on public.users, public.conversations, public.messages to anon, authenticated, service_role;
    grant usage, select on sequence public.messages_id_seq to anon, authenticated, service_role;
  `);
  originalRows = await legacyRows();
  await runSql("../supabase/migrations/202610050001_research_foundation.sql");
}, 20000);

beforeEach(async () => {
  await db.exec("reset role");
});
afterAll(async () => {
  await db.close();
});

test("foundation installs alongside migration 2 and preserves every existing row", async () => {
  expect(await legacyRows()).toEqual(originalRows);
  const tables = await db.query<{ table_name: string }>(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name like 'nuelexity_%'
    order by table_name
  `);
  expect(tables.rows.map((row) => row.table_name)).toEqual([
    "nuelexity_conversations",
    "nuelexity_leases",
    "nuelexity_messages",
    "nuelexity_usage",
  ]);
});

test("new research uses Auth IDs without requiring a legacy public.users profile", async () => {
  const thread = await db.query<{ id: string }>(
    "insert into public.nuelexity_conversations(user_id,title) values ($1,'New research') returning id",
    [authOnlyUser],
  );
  await db.query(
    "insert into public.nuelexity_messages(conversation_id,user_id,role,content) values ($1,$2,'user','New question')",
    [thread.rows[0]!.id, authOnlyUser],
  );
  expect(
    (await db.query("select * from public.users where id = $1", [authOnlyUser])).rows,
  ).toHaveLength(0);
  expect(await legacyRows()).toEqual(originalRows);
});

test("legacy hardening preserves data, denies browser reads/writes and retains server access", async () => {
  await runSql("../supabase/migrations/202610060001_secure_legacy_tables.sql");
  expect(await legacyRows()).toEqual(originalRows);
  const tables = await db.query<{ relrowsecurity: boolean }>(`
    select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('users', 'conversations', 'messages')
  `);
  expect(tables.rows).toHaveLength(3);
  expect(tables.rows.every((table) => table.relrowsecurity)).toBe(true);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const table of ["users", "conversations", "messages"]) {
      await expect(db.query(`select * from public.${table}`)).rejects.toThrow();
      await expect(db.query(`delete from public.${table} where false`)).rejects.toThrow();
    }
    await expect(db.query("select nextval('public.messages_id_seq')")).rejects.toThrow();
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  expect(await legacyRows()).toEqual(originalRows);
  await db.exec("reset role");
  expect((await db.query("select * from auth.users")).rows).toHaveLength(2);
  expect((await db.query("select * from public.nuelexity_conversations")).rows).toHaveLength(1);
});

test("legacy hardening can be rerun without losing rows or changing enum values", async () => {
  await runSql("../supabase/migrations/202610060001_secure_legacy_tables.sql");
  expect(await legacyRows()).toEqual(originalRows);
  const enums = await db.query<{ typname: string; enumlabel: string }>(`
    select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname in ('auth_provider', 'message_role') order by t.typname, e.enumsortorder
  `);
  expect(enums.rows).toEqual([
    { typname: "auth_provider", enumlabel: "GOOGLE" },
    { typname: "auth_provider", enumlabel: "GITHUB" },
    { typname: "message_role", enumlabel: "USER" },
    { typname: "message_role", enumlabel: "ASSISTANT" },
  ]);
});

test("legacy hardening also works on a fresh project without old tables", async () => {
  const fresh = new PGlite();
  try {
    await fresh.exec(
      await Bun.file(
        new URL("../supabase/migrations/202610060001_secure_legacy_tables.sql", import.meta.url),
      ).text(),
    );
    expect(
      (await fresh.query("select * from information_schema.tables where table_schema = 'public'"))
        .rows,
    ).toHaveLength(0);
  } finally {
    await fresh.close();
  }
}, 20000);
