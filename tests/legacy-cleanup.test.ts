import { afterEach, beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
const user = "11111111-1111-4111-8111-111111111111";
const load = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const cleanup = () =>
  load("../supabase/maintenance/202610070001_remove_empty_legacy_tables.sql").then((sql) =>
    db.exec(sql),
  );
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;`);
  await db.exec(await load("fixtures/legacy-schema.sql"));
  await db.exec(await load("../supabase/migrations/202610050001_research_foundation.sql"));
  await db.query("insert into auth.users(id) values ($1)", [user]);
  await db.query(
    "insert into public.nuelexity_conversations(user_id,title) values ($1,'Keep this research')",
    [user],
  );
}, 20000);
afterEach(async () => {
  await db.close();
});

test("optional cleanup removes only empty legacy tables and enums while keeping Auth and new history", async () => {
  await cleanup();
  for (const name of ["users", "conversations", "messages"])
    expect(
      (
        await db.query<{ object: string | null }>("select to_regclass($1) as object", [
          `public.${name}`,
        ])
      ).rows[0]!.object,
    ).toBeNull();
  expect((await db.query("select * from auth.users")).rows).toHaveLength(1);
  expect((await db.query("select * from public.nuelexity_conversations")).rows).toHaveLength(1);
  expect(
    (await db.query("select * from pg_type where typname in ('auth_provider','message_role')"))
      .rows,
  ).toHaveLength(0);
  await cleanup();
});
test("cleanup refuses existing legacy rows and keeps every table", async () => {
  await db.query(
    "insert into public.users(id,email,provider,name) values ($1,'test@example.org','GOOGLE','Test')",
    [user],
  );
  await expect(cleanup()).rejects.toThrow("contains rows");
  await db.exec("rollback");
  expect((await db.query("select * from public.users")).rows).toHaveLength(1);
  expect((await db.query("select * from public.messages")).rows).toHaveLength(0);
});
test("unknown dependencies stop cleanup without CASCADE or partial deletion", async () => {
  await db.exec("create view public.legacy_dependency as select id from public.users");
  await expect(cleanup()).rejects.toThrow();
  await db.exec("rollback");
  expect((await db.query("select to_regclass('public.messages') as object")).rows[0]).toEqual({
    object: "messages",
  });
  expect((await db.query("select * from public.legacy_dependency")).rows).toHaveLength(0);
});
test("custom Auth provisioning triggers must be reviewed before cleanup", async () => {
  await db.exec(`create function public.legacy_auth_hook() returns trigger language plpgsql as $$ begin return new; end; $$;
    create trigger legacy_auth_hook after insert on auth.users for each row execute function public.legacy_auth_hook();`);
  await expect(cleanup()).rejects.toThrow("review custom auth.users triggers");
  await db.exec("rollback");
  expect((await db.query("select * from public.users")).rows).toHaveLength(0);
});
