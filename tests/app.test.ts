import { afterEach, describe, expect, test } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../app.js";
import { readConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { createHmac } from "node:crypto";
import { issueGuestSession } from "../lib/guest-session.js";
import type { Conversation, Message, Providers, Store } from "../lib/types.js";
import { APPROVED_MODELS, modelCatalogue } from "../lib/models.js";
import { createProviders } from "../lib/providers.js";

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
    turnstile?: boolean;
    config?: Partial<ReturnType<typeof readConfig>>;
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
      return { conversation, messages: calls.saved.map((message, index) => ({ ...message, id: `message-${index}`, created_at: "now" }) as Message) };
    },
    create: async (_userId, _query, modelId) => { conversation.selected_model = modelId; return conversation; },
    setModel: async (_userId, _id, modelId) => { conversation.selected_model = modelId; },
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
    models: async () => modelCatalogue({ ...config, aiProvider: "groq" }, new Set(APPROVED_MODELS.map((model) => model.id))),
    search: async () => {
      calls.searches++;
      return [
        { id: 1, title: "Evidence", url: "https://example.org/", snippet: "Grounded evidence." },
      ];
    },
    answer: async function* (_query, _sources, _history, _signal, modelId) {
      calls.answers++;
      yield "First 😹";
      yield " and second [1].";
      return config.aiProvider === "groq" ? { ...APPROVED_MODELS.find((model) => model.id === modelId)!, provider: "Groq" as const } : null;
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
    turnstileSecret: overrides.turnstile ? "test-secret" : "",
    ...overrides.config,
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
  return { base, ask, calls, config };
}

describe("guest verification session", () => {
  test("one verified pass covers repeated searches and refreshed session checks without resetting quota identity", async () => {
    const { base, ask, calls } = await fixture({ turnstile: true });
    expect(
      ((await (await fetch(`${base}/guest/session`)).json()) as { verified: boolean }).verified,
    ).toBe(false);
    const verified = await fetch(`${base}/guest/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnstileToken: "valid" }),
    });
    const session = (await verified.json()) as ReturnType<typeof issueGuestSession>;
    expect(verified.status).toBe(200);
    expect(calls.guestChecks).toBe(1);
    expect(calls.reserves).toBe(0);
    expect(calls.searches).toBe(0);
    const headers = { "X-Guest-Pass": session.pass, "Content-Type": "application/json" };
    expect(
      ((await (await fetch(`${base}/guest/session`, { headers })).json()) as { verified: boolean })
        .verified,
    ).toBe(true);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`${base}/nuelexity_ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: "question" }),
      });
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(calls.guestChecks).toBe(1);
    expect(calls.reserves).toBe(2);
    expect(calls.identities[0]).toBe(calls.identities[1]);
    await (await ask({ query: "legacy client", turnstileToken: "valid" })).text();
    expect(calls.identities[2]).toBe(calls.identities[0]);
    const fresh = (await (
      await fetch(`${base}/guest/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstileToken: "new-valid" }),
      })
    ).json()) as ReturnType<typeof issueGuestSession>;
    expect(fresh.guestId).not.toBe(session.guestId);
    await (
      await fetch(`${base}/nuelexity_ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Guest-Pass": fresh.pass },
        body: JSON.stringify({ query: "new guest ID" }),
      })
    ).text();
    expect(calls.identities[3]).toBe(calls.identities[0]);
  });
  test("invalid proof and failed challenges cannot reserve quota or call providers", async () => {
    const { base, calls } = await fixture({
      turnstile: true,
      providers: {
        verifyGuest: async () => {
          throw new AppError(403, "BOT_CHECK_FAILED", "Try again.");
        },
      },
    });
    const failure = await fetch(`${base}/guest/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnstileToken: "bad" }),
    });
    expect(failure.status).toBe(403);
    expect(await failure.text()).not.toContain("pass");
    expect(
      (
        (await (
          await fetch(`${base}/guest/session`, { headers: { "X-Guest-Pass": "forged" } })
        ).json()) as { verified: boolean }
      ).verified,
    ).toBe(false);
    const rejected = await fetch(`${base}/nuelexity_ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Guest-Pass": "forged" },
      body: JSON.stringify({ query: "question" }),
    });
    expect(rejected.status).toBe(403);
    expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
      "BOT_SESSION_EXPIRED",
    );
    expect(calls.reserves).toBe(0);
    expect(calls.searches).toBe(0);
  });
  test("development bypass cannot issue a verified pass and disabled production guests cannot use old passes", async () => {
    const development = await fixture();
    const attempt = await fetch(`${development.base}/guest/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnstileToken: "fake" }),
    });
    expect(attempt.status).toBe(503);
    expect(development.calls.guestChecks).toBe(0);
    const production = await fixture({ config: { production: true, guestsEnabled: false } });
    const ip = createHmac("sha256", production.config.guestSecret)
      .update("127.0.0.1")
      .digest("hex");
    const pass = issueGuestSession(production.config.guestSecret, ip).pass;
    const blocked = await fetch(`${production.base}/nuelexity_ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Guest-Pass": pass },
      body: JSON.stringify({ query: "cannot bypass disabled guests" }),
    });
    expect(blocked.status).toBe(503);
    expect(production.calls.reserves).toBe(0);
    expect(production.calls.searches).toBe(0);
  });
});

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
          return null;
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

describe("model selection", () => {
  const model20 = "openai/gpt-oss-20b", model120 = "openai/gpt-oss-120b", qwen = "qwen/qwen3.8-27b";
  const ai = { aiProvider: "groq" as const };
  async function choose(base: string, modelId: string, token = "good") {
    return fetch(`${base}/conversations/${id}/model`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ modelId }),
    });
  }
  test("catalogue shares approved labels, Preview and configured default; access comes from verified auth", async () => {
    const { base, config } = await fixture({ config: ai });
    const guest = await (await fetch(`${base}/models`)).json() as any;
    expect(guest.canSelect).toBe(false);
    expect(guest.defaultModelId).toBe(config.groqModel);
    expect(guest.models.map((model: any) => model.id)).toEqual([model20, model120, qwen]);
    expect(guest.models[2]).toMatchObject({ name: "Qwen 3.8 27B", preview: true, provider: "Groq" });
    const member = await (await fetch(`${base}/models`, { headers: { Authorization: "Bearer good" } })).json() as any;
    expect(member.canSelect).toBe(true);
    expect((await fetch(`${base}/models`, { headers: { Authorization: "Bearer forged" } })).status).toBe(401);
  });
  test("authenticated selections reach the actual provider adapter with the correct ID without changing config", async () => {
    const sent: string[] = [];
    const adapter = createProviders(readConfig({ AI_PROVIDER: "groq" }), async (url, options) => {
      expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
      const body = JSON.parse(options.body as string);
      sent.push(body.model);
      return new Response(`data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: "Evidence [1]" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    const { ask, calls, config } = await fixture({ config: ai, providers: { answer: adapter.answer } });
    for (const modelId of [model120, qwen, model20]) {
      const response = await ask({ query: "question", modelId }, "good");
      expect(await response.text()).toContain('event: done');
    }
    expect(sent).toEqual([model120, qwen, model20]);
    expect(config.groqModel).toBe(model20);
    expect(calls.saved.filter((message) => message.role === "assistant").map((message) => message.model?.id)).toEqual(sent);
  });
  test("saved selection survives reopening and subsequent switches preserve older answer labels", async () => {
    const { base, ask, calls } = await fixture({ config: ai });
    await (await ask({ query: "first", modelId: model120 }, "good")).text();
    let detail = await (await fetch(`${base}/conversations/${id}`, { headers: { Authorization: "Bearer good" } })).json() as any;
    expect(detail.conversation.selected_model).toBe(model120);
    expect((await choose(base, qwen)).status).toBe(200);
    await (await ask({ query: "second", conversationId: id }, "good")).text();
    detail = await (await fetch(`${base}/conversations/${id}`, { headers: { Authorization: "Bearer good" } })).json() as any;
    expect(detail.conversation.selected_model).toBe(qwen);
    expect(detail.messages.filter((message: Message) => message.role === "assistant").map((message: Message) => message.model?.id)).toEqual([model120, qwen]);
    expect(calls.reserves).toBe(2);
  });
  test("an in-flight model stays frozen while a different choice is saved for the next request", async () => {
    let proceed!: () => void, started!: () => void;
    const wait = new Promise<void>((resolve) => { proceed = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const { base, ask, calls } = await fixture({ config: ai, providers: {
      answer: async function* (_q, _s, _h, _signal, modelId) {
        started(); await wait;
        yield "answer";
        return { ...APPROVED_MODELS.find((model) => model.id === modelId)!, provider: "Groq" };
      },
    }});
    const response = await ask({ query: "question", modelId: model20 }, "good");
    await ready;
    expect((await choose(base, qwen)).status).toBe(200);
    proceed();
    const text = await response.text();
    expect(text).toContain(`"requestedModelId":"${model20}"`);
    expect(calls.saved[1]?.model?.id).toBe(model20);
    const detail = await (await fetch(`${base}/conversations/${id}`, { headers: { Authorization: "Bearer good" } })).json() as any;
    expect(detail.conversation.selected_model).toBe(qwen);
  });
  test("guest overrides, unknown IDs and forged auth never reach quota, bot, search or answer calls", async () => {
    const { ask, calls } = await fixture({ config: ai });
    for (const [modelId, token, status] of [[model120, undefined, 403], ["not-approved", "good", 400], [model120, "forged", 401]] as const)
      expect((await ask({ query: "question", modelId }, token)).status).toBe(status);
    expect(calls.reserves).toBe(0); expect(calls.guestChecks).toBe(0);
    expect(calls.searches).toBe(0); expect(calls.answers).toBe(0);
    const guest = await ask({ query: "question", modelId: model20 });
    expect(await guest.text()).toContain(`"id":"${model20}"`);
  });
  test("quota allowance belongs to the account, spanning model switches", async () => {
    let reservations = 0;
    const identities: string[] = [];
    const { ask, calls } = await fixture({ config: ai, store: { reserve: async (identity) => {
      identities.push(identity.subject);
      return ++reservations <= 1 ? { allowed: true } : { allowed: false, code: "DAILY_LIMIT", retryAfter: 60 };
    }}});
    await (await ask({ query: "first", modelId: model20 }, "good")).text();
    expect((await ask({ query: "second", modelId: qwen }, "good")).status).toBe(429);
    expect(identities).toEqual([`user:${owner}`, `user:${owner}`]);
    expect(calls.answers).toBe(1);
  });
  test("retired stored selections and unavailable models block before generation without defaulting", async () => {
    const { base, ask, calls } = await fixture({ config: ai, store: {
      detail: async () => ({ conversation: { id, title: "Old", created_at: "now", updated_at: "now", selected_model: "retired/model" }, messages: [] }),
    }});
    expect((await ask({ query: "question", conversationId: id }, "good")).status).toBe(400);
    expect(calls.searches).toBe(0); expect(calls.answers).toBe(0); expect(calls.reserves).toBe(0);
    expect((await choose(base, model20)).status).toBe(200);
    const unavailable = await fixture({ config: ai, providers: { models: async () => modelCatalogue(readConfig({ AI_PROVIDER: "groq" }), new Set([model20])) } });
    expect((await unavailable.ask({ query: "question", modelId: qwen }, "good")).status).toBe(409);
    expect(unavailable.calls.searches).toBe(0); expect(unavailable.calls.answers).toBe(0);
  });
  test("only owners may persist choices and changing a choice reserves no search allowance", async () => {
    const { base, calls } = await fixture({ config: ai });
    expect((await choose(base, qwen, "other")).status).toBe(404);
    expect((await choose(base, "not-approved")).status).toBe(400);
    expect((await choose(base, model120)).status).toBe(200);
    expect(calls.reserves).toBe(0); expect(calls.answers).toBe(0);
  });
  test("provider permission failures retain reservations and partial text without model attribution or fallback", async () => {
    const { ask, calls } = await fixture({ config: ai, providers: { answer: async function* () {
      yield "Partial"; throw new AppError(409, "MODEL_PERMISSION", "Choose another model.");
    }}});
    const text = await (await ask({ query: "question", modelId: qwen }, "good")).text();
    expect(text).toContain("MODEL_PERMISSION"); expect(text).not.toContain("event: done");
    expect(calls.reserves).toBe(1); expect(calls.saved[1]).toMatchObject({ status: "failed" });
    expect(calls.saved[1]?.model).toBeUndefined();
  });
});

describe("contextual follow-up protocol", () => {
  const marker = "<|nuelexity_follow_ups_v1|>";
  const text = "RSA key generation uses prime factors [1].";
  const question = "Can you walk me through RSA key generation with small numbers?";
  test("one reserved answer call separates metadata and persists suggestions with the correct completed answer", async () => {
    let callsToAnswer=0;
    const {ask,calls,base}=await fixture({config:{aiProvider:'groq'},providers:{answer:async function* () {
      callsToAnswer++;
      for(const char of text+'\n'+marker+JSON.stringify({questions:[{question,anchor:'key generation'}]})) yield char;
      return {...APPROVED_MODELS[0],provider:'Groq' as const};
    }}});
    const response=await ask({query:'What is RSA key generation?'},'good');
    const wire=await response.text();
    expect(callsToAnswer).toBe(1); expect(calls.reserves).toBe(1);
    expect(wire).not.toContain('nuelexity_follow_ups'); expect(wire).not.toContain('anchor');
    expect(wire).toContain(JSON.stringify({questions:[question]}));
    const saved=calls.saved.find(message=>message.role==='assistant')!;
    expect(saved.content).toBe(text+'\n'); expect(saved.followUps).toEqual([question]); expect(saved.status).toBe('complete');
    const detail=await (await fetch(base+'/conversations/'+id,{headers:{Authorization:'Bearer good'}})).json() as {messages:Message[]};
    expect(detail.messages.at(-1)!.followUps).toEqual([question]);
    expect(detail.messages.at(-1)!.model!.provider).toBe('Groq');
  });
  test("a malformed footer never invalidates a completed answer; interrupted metadata never becomes success", async () => {
    for(const interrupted of [false,true]) {
      const {ask,calls}=await fixture({config:{aiProvider:'groq'},providers:{answer:async function* () {
        yield text+marker+'{"questions":';
        if(interrupted) throw new AppError(502,'INCOMPLETE_STREAM','Interrupted');
        return {...APPROVED_MODELS[0],provider:'Groq' as const};
      }}});
      const wire=await (await ask({query:'Explain RSA'},'good')).text();
      expect(wire).not.toContain(marker); expect(wire).not.toContain('"questions":}');
      const saved=calls.saved.find(message=>message.role==='assistant')!;
      expect(saved.content).toBe(text); expect(saved.followUps).toEqual([]);
      expect(saved.status).toBe(interrupted?'failed':'complete');
      expect(wire.includes('event: done')).toBe(!interrupted);
    }
  });
});
