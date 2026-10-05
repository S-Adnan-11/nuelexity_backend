import { expect, test } from "bun:test";
import { createSupabaseClient } from "../client";
import { readConfig } from "../lib/config";
import { createStore } from "../lib/store";

const owner = "11111111-1111-4111-8111-111111111111",
  id = "33333333-3333-4333-8333-333333333333";
const config = readConfig({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  GUEST_ID_SECRET: "pepper".repeat(8),
});
test("auth verifies with the public key and stripped Bearer token, never creates users", async () => {
  const store = createStore(config, async (url, options) => {
    expect(url).toBe("https://test.supabase.co/auth/v1/user");
    expect(options.headers).toEqual({
      apikey: "sb_publishable_test",
      Authorization: "Bearer user-token",
    });
    return Response.json({ id: owner });
  });
  expect(await store.verifyToken("user-token")).toBe(owner);
});
test("conversation reads and writes always filter or carry the verified owner", async () => {
  const calls: { url: URL; options: RequestInit }[] = [];
  const store = createStore(config, async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (parsed.pathname.endsWith("nuelexity_conversations"))
      return Response.json([{ id, title: "Owned" }]);
    if (options.method === "POST") return new Response(null, { status: 201 });
    return Response.json([
      {
        id: "message",
        role: "assistant",
        content: "answer",
        follow_ups: ["Follow up"],
        sources: [],
        status: "complete",
        created_at: "now",
      },
    ]);
  });
  await store.list(owner, 0);
  const detail = await store.detail(owner, id);
  expect(detail.messages[0]!.followUps).toEqual(["Follow up"]);
  await store.save(owner, id, {
    role: "user",
    content: "q",
    sources: [],
    followUps: [],
    status: "complete",
  });
  await store.remove(owner, id);
  for (const call of calls) {
    if (call.options.method === "POST")
      expect(JSON.parse(call.options.body as string).user_id).toBe(owner);
    else expect(call.url.searchParams.get("user_id")).toBe(`eq.${owner}`);
  }
});
test("unowned conversation responses prevent message queries and writes", async () => {
  let count = 0;
  const store = createStore(config, async () => {
    count++;
    return Response.json([]);
  });
  await expect(store.detail(owner, id)).rejects.toThrow("not found");
  await expect(store.remove(owner, id)).rejects.toThrow("not found");
  expect(count).toBe(2);
});
test("modern secrets use apikey and legacy service JWTs use a Bearer header", async () => {
  for (const key of ["sb_secret_test", "legacy-service-jwt"]) {
    const client = createSupabaseClient({ ...config, secret: key }, async (_url, options) => {
      const headers = options.headers as Record<string, string>;
      expect(headers.apikey).toBe(key);
      expect(headers.Authorization).toBe(
        key.startsWith("sb_secret_") ? undefined : `Bearer ${key}`,
      );
      return new Response(null, { status: 204 });
    });
    await client("table");
  }
});
test("database error payloads are not exposed", async () => {
  const client = createSupabaseClient(config, async () =>
    Response.json({ error: "private credentials" }, { status: 500 }),
  );
  try {
    await client("table");
    throw new Error("expected failure");
  } catch (error) {
    expect((error as Error).message).not.toContain("credentials");
    expect((error as Error).message).toContain("Database request failed");
  }
});
