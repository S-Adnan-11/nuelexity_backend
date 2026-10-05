import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const ip = "a".repeat(64),
  otherIp = "b".repeat(64);
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${owner}'), ('${other}');`);
  await db.exec(
    await Bun.file(
      new URL("../supabase/migrations/202610050001_research_foundation.sql", import.meta.url),
    ).text(),
  );
}, 20000);
beforeEach(async () => {
  await db.exec(
    "reset role; truncate public.nuelexity_conversations cascade; truncate public.nuelexity_usage, public.nuelexity_leases;",
  );
});
afterAll(async () => {
  await db.close();
});

async function reserve(subject = `guest:${ip}`, address = ip, limits = [2, 10, 25, 800, 30]) {
  const id = randomUUID();
  const result = await db.query<{
    result: { allowed: boolean; code?: string; remaining?: number };
  }>("select public.nuelexity_reserve_request($1,$2,$3,$4,$5,$6,$7,$8) as result", [
    subject,
    address,
    id,
    ...limits,
  ]);
  return { ...result.rows[0]!.result, id };
}
async function release(subject: string, id: string) {
  await db.query("select public.nuelexity_release_request($1,$2)", [subject, id]);
}

describe("durable budget reservations", () => {
  test("counts guest attempts and enforces daily cap after leases release", async () => {
    const subject = `guest:${ip}`;
    const first = await reserve();
    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    await release(subject, first.id);
    const second = await reserve();
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    await release(subject, second.id);
    expect(await reserve()).toMatchObject({ allowed: false, code: "DAILY_LIMIT" });
    const count = await db.query<{ requests: number }>(
      "select requests from public.nuelexity_usage where subject = 'global' and bucket = 'month'",
    );
    expect(count.rows[0]!.requests).toBe(2);
  });
  test("allows only one active request per identity and fences stale releases", async () => {
    const first = await reserve();
    expect(await reserve()).toMatchObject({ allowed: false, code: "REQUEST_IN_PROGRESS" });
    await release(`guest:${ip}`, randomUUID());
    expect(await reserve()).toMatchObject({ allowed: false, code: "REQUEST_IN_PROGRESS" });
    await release(`guest:${ip}`, first.id);
    expect(await reserve()).toMatchObject({ allowed: true });
  });
  test("shared daily/monthly/minute caps span unrelated identities", async () => {
    for (const [index, code] of [
      [2, "GLOBAL_DAILY_LIMIT"],
      [3, "GLOBAL_MONTHLY_LIMIT"],
      [4, "GLOBAL_MINUTE_LIMIT"],
    ] as const) {
      await db.exec("truncate public.nuelexity_usage, public.nuelexity_leases");
      const limits = [5, 10, 25, 800, 30];
      limits[index] = 1;
      expect(await reserve(`user:${owner}`, ip, limits)).toMatchObject({ allowed: true });
      expect(await reserve(`user:${other}`, otherIp, limits)).toMatchObject({
        allowed: false,
        code,
      });
    }
  });
  test("an IP ceiling spans guest and signed-in accounts", async () => {
    const limits = [5, 1, 25, 800, 30];
    expect(await reserve(`guest:${ip}`, ip, limits)).toMatchObject({ allowed: true });
    expect(await reserve(`user:${owner}`, ip, limits)).toMatchObject({
      allowed: false,
      code: "IP_DAILY_LIMIT",
    });
  });
  test("rejects simultaneous requests once the global cap is reached", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        reserve(`guest:${String(i).repeat(64)}`, String(i).repeat(64), [5, 10, 2, 800, 30]),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(2);
    expect(results.filter((r) => r.code === "GLOBAL_DAILY_LIMIT")).toHaveLength(4);
  });
  test("UTC reset works and old/expired entries do not affect a new day", async () => {
    await db.exec(`set timezone = 'Pacific/Honolulu';
      insert into public.nuelexity_usage values ('guest:${ip}', 'day', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '1 day', 50);
      insert into public.nuelexity_leases values ('guest:${ip}', '${randomUUID()}', now() - interval '1 second');`);
    expect(await reserve()).toMatchObject({ allowed: true, remaining: 1 });
    const periods = await db.query<{ utc_day: string }>(
      "select to_char(period_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc_day from public.nuelexity_usage where subject = 'global' and bucket = 'day'",
    );
    expect(periods.rows[0]!.utc_day.endsWith("00:00")).toBe(true);
    await db.exec("set timezone = 'UTC'");
  });
});

describe("RLS and privileges", () => {
  test("users read only their own conversations/messages", async () => {
    const a = randomUUID(),
      b = randomUUID();
    await db.query(
      "insert into public.nuelexity_conversations(id,user_id,title) values ($1,$2,'A'),($3,$4,'B')",
      [a, owner, b, other],
    );
    await db.query(
      "insert into public.nuelexity_messages(conversation_id,user_id,role,content) values ($1,$2,'user','hello'),($3,$4,'user','other')",
      [a, owner, b, other],
    );
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}'`);
    expect((await db.query("select * from public.nuelexity_conversations")).rows).toHaveLength(1);
    expect((await db.query("select * from public.nuelexity_messages")).rows).toHaveLength(1);
  });
  test("browser roles cannot mutate history, read counters, or call quota RPCs", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from public.nuelexity_usage")).rejects.toThrow();
      await expect(
        db.query("insert into public.nuelexity_conversations(user_id,title) values ($1,'bypass')", [
          owner,
        ]),
      ).rejects.toThrow();
      await expect(reserve()).rejects.toThrow();
      await expect(release(`guest:${ip}`, randomUUID())).rejects.toThrow();
      await db.exec("reset role");
    }
  });
  test("message owner must match the conversation even for a service role", async () => {
    const id = randomUUID();
    await db.query(
      "insert into public.nuelexity_conversations(id,user_id,title) values ($1,$2,'Owned')",
      [id, owner],
    );
    await db.exec("set role service_role");
    await expect(
      db.query(
        "insert into public.nuelexity_messages(conversation_id,user_id,role,content) values ($1,$2,'user','oops')",
        [id, other],
      ),
    ).rejects.toThrow();
    await db.query(
      "insert into public.nuelexity_messages(conversation_id,user_id,role,content) values ($1,$2,'user','allowed')",
      [id, owner],
    );
  });
  test("owner deletion cascades messages and service role can use RPCs", async () => {
    const id = randomUUID();
    await db.query(
      "insert into public.nuelexity_conversations(id,user_id,title) values ($1,$2,'Owned')",
      [id, owner],
    );
    await db.query(
      "insert into public.nuelexity_messages(conversation_id,user_id,role,content) values ($1,$2,'user','hello')",
      [id, owner],
    );
    await db.exec("set role service_role");
    expect(await reserve()).toMatchObject({ allowed: true });
    await db.query("delete from public.nuelexity_conversations where id=$1", [id]);
    expect((await db.query("select * from public.nuelexity_messages")).rows).toHaveLength(0);
  });
});
