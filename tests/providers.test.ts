import { expect, test } from "bun:test";
import { readConfig } from "../lib/config";
import { createProviders, safeUrl } from "../lib/providers";
import type { ProviderFetch } from "../lib/providers";
import { readSse } from "../lib/sse";

const signal = new AbortController().signal;
function packets(text: string, size = 1) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
}
test("SSE parser handles fragmented UTF-8, CRLF, comments and multiple packets", async () => {
  const body = packets(': heartbeat\r\n\r\ndata: {"text":"sha 😹"}\r\n\r\ndata: [DONE]\n\n');
  const output = [];
  for await (const item of readSse(body)) output.push(item);
  expect(output).toEqual(['{"text":"sha 😹"}', "[DONE]"]);
});
test("Tavily is basic, never auto-upgrades/retries, filters unsafe URLs and clips sources", async () => {
  let count = 0;
  const http = (async (_url: unknown, options: RequestInit) => {
    count++;
    expect(JSON.parse(options.body as string)).toMatchObject({
      search_depth: "basic",
      auto_parameters: false,
      include_answer: false,
      max_results: 5,
    });
    return Response.json({
      results: [
        { title: "bad", url: "javascript:alert(1)", content: "bad" },
        { title: "ok", url: "https://example.org", content: "x".repeat(4000) },
        { title: "duplicate", url: "https://example.org/", content: "duplicate" },
      ],
    });
  }) satisfies ProviderFetch;
  const sources = await createProviders(readConfig({}), http).search("test", signal);
  expect(sources).toHaveLength(1);
  expect(sources[0]!.id).toBe(1);
  expect(sources[0]!.snippet).toHaveLength(1500);
  expect(count).toBe(1);
  expect(safeUrl("https://user:password@example.org")).toBeNull();
});
test("sources-only mode never calls a model and labels excerpts honestly", async () => {
  const providers = createProviders(readConfig({}), () => {
    throw new Error("No HTTP should occur");
  });
  let text = "";
  for await (const delta of providers.answer(
    "q",
    [{ id: 1, title: "Source", url: "https://example.org", snippet: "Evidence" }],
    [],
    signal,
  ))
    text += delta;
  expect(text).toContain("not an AI-synthesized answer");
  expect(text).toContain("Evidence");
});
test("Groq streams all deltas and requires successful finish plus done", async () => {
  const config = readConfig({ AI_PROVIDER: "groq" });
  const evidence = [{ id: 1, title: "Source", url: "https://example.org", snippet: "Evidence" }];
  for (const finish of ["stop", "length", null]) {
    const http = (async () =>
      new Response(
        packets(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello 😹" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
        ),
      )) satisfies ProviderFetch;
    const collect = async () => {
      let result = "";
      for await (const d of createProviders(config, http).answer("q", evidence, [], signal))
        result += d;
      return result;
    };
    if (finish === "stop") expect(await collect()).toBe("Hello 😹");
    else await expect(collect()).rejects.toThrow();
  }
});
test("GPT-OSS streams only final answer content with a bounded request and no automatic retry", async () => {
  let calls = 0;
  const http = (async (_url: string, options: RequestInit) => {
    calls++;
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({
      model: "openai/gpt-oss-20b",
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: 1024,
      stream: true,
    });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("reasoning_format");
    return new Response(
      packets(
        'data: {"choices":[{"delta":{"reasoning":"private reasoning"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"Grounded answer [1]"},"finish_reason":"stop"}]}\n\n' +
          "data: [DONE]\n\n",
      ),
    );
  }) satisfies ProviderFetch;
  let answer = "";
  for await (const delta of createProviders(readConfig({ AI_PROVIDER: "groq" }), http).answer(
    "question",
    [{ id: 1, title: "Evidence", url: "https://example.org", snippet: "Facts" }],
    [],
    signal,
  ))
    answer += delta;
  expect(answer).toBe("Grounded answer [1]");
  expect(calls).toBe(1);
});
test("optional Qwen model stays within the same request budget and excludes reasoning", async () => {
  const http = (async (_url: string, options: RequestInit) => {
    expect(JSON.parse(options.body as string)).toMatchObject({
      model: "qwen/qwen3.8-27b",
      reasoning_effort: "none",
      include_reasoning: false,
      max_completion_tokens: 1024,
    });
    return new Response(
      packets(
        'data: {"choices":[{"delta":{"content":"Answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    );
  }) satisfies ProviderFetch;
  let result = "";
  for await (const delta of createProviders(
    readConfig({ AI_PROVIDER: "groq", GROQ_MODEL: "qwen/qwen3.8-27b" }),
    http,
  ).answer(
    "question",
    [{ id: 1, title: "Source", url: "https://example.org", snippet: "Evidence" }],
    [],
    signal,
  ))
    result += delta;
  expect(result).toBe("Answer");
});
test("production guest search cannot bypass missing or failed bot verification", async () => {
  await expect(
    createProviders(readConfig({ NODE_ENV: "production" })).verifyGuest("", "127.0.0.1", signal),
  ).rejects.toThrow();
  const providers = createProviders(readConfig({ TURNSTILE_SECRET_KEY: "test" }), async () =>
    Response.json({ success: true, hostname: "evil.example", action: "search" }),
  );
  await expect(providers.verifyGuest("token", "127.0.0.1", signal)).rejects.toThrow();
});
test("misconfigured or excessive budget settings fail at startup", () => {
  expect(() => readConfig({ GLOBAL_MONTHLY_LIMIT: "1001" })).toThrow();
  expect(() => readConfig({ AI_PROVIDER: "paid-gateway" })).toThrow();
});
