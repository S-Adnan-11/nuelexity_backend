import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { createApp } from "../app";
import { readConfig } from "../lib/config";
import { AppError } from "../lib/errors";
import type { Conversation, Message, Providers, Store } from "../lib/types";

const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function fixture(
  overrides: {
    store?: Partial<Store>;
    providers?: Partial<Providers>;
    configured?: boolean;
    timeout?: number;
  } = {},
) {
  const calls = {
    searches: 0,
    answers: 0,
    reserves: 0,
    releases: 0,
    guestChecks: 0,
    saved: [] as Partial<Message>[],
    identities: [] as string[],
  };
  const conversation: Conversation = {
    id,
    title: "Research",
    created_at: "now",
    updated_at: "now",
  };
  const store: Store = {
    verifyToken: async (token) => {
      if (token === "good") return owner;
      if (token === "other") return other;
      throw new AppError(401, "UNAUTHORIZED", "Invalid token.");
    },
    list: async () => [conversation],
    detail: async (userId) => {
      if (userId !== owner) throw new AppError(404, "NOT_FOUND", "Conversation not found.");
      return { conversation, messages: [] };
    },
    create: async () => conversation,
    remove: async () => {},
    ready: async () => {},
    save: async (_userId, _id, message) => {
      calls.saved.push(message);
    },
    reserve: async (identity) => {
      calls.reserves++;
      calls.identities.push(identity.subject);
      return { allowed: true, remaining: 1 };
    },
    release: async () => {
      calls.releases++;
    },
    ...overrides.store,
  };
  const providers: Providers = {
    search: async () => {
      calls.searches++;
      return [
        { id: 1, title: "Evidence", url: "https://example.org/", snippet: "Grounded evidence." },
      ];
    },
    answer: async function* () {
      calls.answers++;
      yield "First 😹";
      yield " and second [1].";
    },
    verifyGuest: async () => {
      calls.guestChecks++;
    },
    ...overrides.providers,
  };
  const config = {
    ...readConfig({}),
    configured: overrides.configured !== false,
    guestSecret: "test-secret".repeat(4),
    requestTimeoutMs: overrides.timeout || 1000,
  };
  const server = createApp({ config, store, providers }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const ask = (body: unknown, token?: string, signal?: AbortSignal) =>
    fetch(`${base}/nuelexity_ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  return { base, ask, calls };
}

describe("HTTP search contract", () => {
  test("guests get every delta, numbered sources, follow-ups and one done event", async () => {
    const { ask, calls } = await fixture();
    const response = await ask({ query: "question" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"conversationId":null');
    expect(text).toContain('"text":"First 😹"');
    expect(text).toContain('"text":" and second [1]."');
    expect(text).toContain("event: sources");
    expect(text).toContain("event: follow_ups");
    expect(text.match(/event: done/g)).toHaveLength(1);
    expect(calls.searches).toBe(1);
    expect(calls.answers).toBe(1);
    expect(calls.reserves).toBe(1);
    expect(calls.saved).toHaveLength(0);
  });
  test("signed-in requests use verified identity and save both turns", async () => {
    const { ask, calls } = await fixture();
    const response = await ask({ query: "question" }, "good");
    await response.text();
    expect(calls.guestChecks).toBe(0);
    expect(calls.identities).toEqual([`user:${owner}`]);
    expect(calls.saved).toHaveLength(2);
    expect(calls.saved[1]).toMatchObject({
      role: "assistant",
      status: "complete",
      content: "First 😹 and second [1].",
    });
  });
  test("invalid queries, extra fields, and forged user IDs never spend credits", async () => {
    const { ask, calls } = await fixture();
    for (const body of [
      { query: " " },
      { query: "x".repeat(1001) },
      { query: "ok", userId: owner },
      { query: "ok", conversationId: "bad" },
    ])
      expect((await ask(body)).status).toBe(400);
    expect(calls.searches).toBe(0);
    expect(calls.reserves).toBe(0);
  });
  test("invalid auth does not downgrade to guest; auth-required history stays protected", async () => {
    const { base, ask, calls } = await fixture();
    expect((await ask({ query: "test" }, "bad")).status).toBe(401);
    expect((await fetch(`${base}/conversations`)).status).toBe(401);
    expect(calls.searches).toBe(0);
    expect(calls.guestChecks).toBe(0);
  });
  test("cross-user and guest conversation access fail before reservation", async () => {
    const { ask, calls } = await fixture();
    expect((await ask({ query: "test", conversationId: id }, "other")).status).toBe(404);
    expect((await ask({ query: "test", conversationId: id })).status).toBe(401);
    expect(calls.reserves).toBe(0);
    expect(calls.searches).toBe(0);
  });
  test("quota denials expose retry time and never call providers", async () => {
    const { ask, calls } = await fixture({
      store: { reserve: async () => ({ allowed: false, code: "DAILY_LIMIT", retryAfter: 3600 }) },
    });
    const response = await ask({ query: "test" });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(calls.searches).toBe(0);
    expect(calls.answers).toBe(0);
  });
  test("missing config or quota storage fail closed", async () => {
    for (const options of [
      { configured: false },
      {
        store: {
          reserve: async () => {
            throw new Error("database password should not leak");
          },
        },
      },
    ]) {
      const { ask, calls } = await fixture(options);
      const response = await ask({ query: "test" });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("password");
      expect(calls.searches).toBe(0);
    }
  });
  test("provider failure sends error, preserves sources and marks persisted turn failed", async () => {
    const { ask, calls } = await fixture({
      providers: {
        answer: async function* () {
          yield "Partial";
          throw new Error("private key");
        },
      },
    });
    const response = await ask({ query: "test" }, "good");
    const text = await response.text();
    expect(text).toContain("event: sources");
    expect(text).toContain("event: error");
    expect(text).not.toContain("event: done");
    expect(text).not.toContain("private key");
    expect(calls.saved[1]?.status).toBe("failed");
  });
  test("request timeout aborts provider work and cannot report completion", async () => {
    const { ask } = await fixture({
      timeout: 30,
      providers: {
        search: async (_query, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          ),
      },
    });
    const text = await (await ask({ query: "test" })).text();
    expect(text).toContain('"code":"TIMEOUT"');
    expect(text).not.toContain("event: done");
  });
  test("client cancellation aborts generation and releases the active request", async () => {
    let providerAborted!: () => void, leaseReleased!: () => void;
    const aborted = new Promise<void>((resolve) => {
      providerAborted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      leaseReleased = resolve;
    });
    const { ask } = await fixture({
      store: {
        release: async () => {
          leaseReleased();
        },
      },
      providers: {
        answer: async function* (_q, _s, _h, signal) {
          yield "Partial";
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => {
                providerAborted();
                reject(signal.reason);
              },
              { once: true },
            ),
          );
        },
      },
    });
    const controller = new AbortController();
    const response = await ask({ query: "test" }, undefined, controller.signal);
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await Promise.all([aborted, released]);
    expect(controller.signal.aborted).toBe(true);
  });
  test("saved follow-ups use server history to contextualize web search", async () => {
    let retrieval = "";
    const { ask } = await fixture({
      store: {
        detail: async () => ({
          conversation: { id, title: "Owned", created_at: "now", updated_at: "now" },
          messages: [
            {
              id: "m",
              role: "user",
              content: "What is Rust?",
              sources: [],
              followUps: [],
              status: "complete",
              created_at: "now",
            },
          ],
        }),
      },
      providers: {
        search: async (query) => {
          retrieval = query;
          return [];
        },
      },
    });
    await (await ask({ query: "What about memory safety?", conversationId: id }, "good")).text();
    expect(retrieval).toContain("What is Rust?");
    expect(retrieval).toContain("What about memory safety?");
  });
  test("unknown browser origin and oversized/malformed bodies are rejected", async () => {
    const { base, calls } = await fixture();
    expect(
      (await fetch(`${base}/health`, { headers: { Origin: "https://evil.example" } })).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/nuelexity_ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${base}/nuelexity_ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "x".repeat(18000) }),
        })
      ).status,
    ).toBe(413);
    const preflight = await fetch(`${base}/nuelexity_ask`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization,Content-Type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(calls.searches).toBe(0);
  });
});
