import { expect, test } from "vitest";
import { readConfig } from "../lib/config.js";
import { createProviders, safeUrl } from "../lib/providers.js";
import type { ProviderFetch } from "../lib/providers.js";
import { readSse } from "../lib/sse.js";

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
          `data: ${JSON.stringify({ model: config.groqModel, choices: [{ delta: { content: "Hello 😹" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
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
          'data: {"model":"openai/gpt-oss-20b","choices":[{"delta":{"content":"Grounded answer [1]"},"finish_reason":"stop"}]}\n\n' +
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
        'data: {"model":"qwen/qwen3.8-27b","choices":[{"delta":{"content":"Answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
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

test("catalogue exposes only approved models, disables missing candidates and caches metadata without generation calls", async () => {
  let calls = 0;
  const providers = createProviders(readConfig({ AI_PROVIDER: "groq" }), async (url) => {
    calls++;
    expect(url).toBe("https://api.groq.com/openai/v1/models");
    return Response.json({ data: [{ id: "openai/gpt-oss-20b" }, { id: "not-approved" }] });
  });
  const catalogue = await providers.models();
  expect(catalogue.models).toHaveLength(3);
  expect(catalogue.models[0]?.available).toBe(true);
  expect(catalogue.models[2]).toMatchObject({ preview: true, available: false });
  expect(catalogue.models.some((model) => model.id === "not-approved")).toBe(false);
  await providers.models();
  expect(calls).toBe(1);
});
test("provider rejects unknown IDs before HTTP and rejects missing or mismatched actual attribution", async () => {
  for (const actual of [null, "openai/gpt-oss-120b"]) {
    let calls = 0;
    const providers = createProviders(readConfig({ AI_PROVIDER: "groq" }), async () => {
      calls++;
      return new Response(`data: ${JSON.stringify({ ...(actual ? { model: actual } : {}), choices: [{ delta: { content: "Answer" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    const collect = async (modelId: string) => {
      for await (const _ of providers.answer("question", [{ id: 1, title: "Source", url: "https://example.org", snippet: "Evidence" }], [], signal, modelId)) {}
    };
    await expect(collect("unknown")).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(collect("openai/gpt-oss-20b")).rejects.toThrow();
    expect(calls).toBe(1);
  }
});
test("permissions, retired models, rate limits and server failures make one call with no fallback", async () => {
  for (const [status, code] of [[403, "MODEL_PERMISSION"], [404, "MODEL_UNAVAILABLE"], [429, "MODEL_RATE_LIMIT"], [500, "ANSWER_UNAVAILABLE"]] as const) {
    let calls = 0;
    const providers = createProviders(readConfig({ AI_PROVIDER: "groq" }), async () => {
      calls++; return new Response(null, { status, headers: { "Retry-After": "17" } });
    });
    try {
      for await (const _ of providers.answer("question", [{ id: 1, title: "Source", url: "https://example.org", snippet: "Evidence" }], [], signal, "qwen/qwen3.8-27b")) {}
      throw new Error("Expected failure");
    } catch (error) {
      expect((error as {code: string}).code).toBe(code);
      if (status === 429) expect((error as {retryAfter: number}).retryAfter).toBe(17);
    }
    expect(calls).toBe(1);
  }
});
test("all models bound UTF-8 input plus output and do not send tools or reasoning text", async () => {
  for (const modelId of ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"]) {
    const providers = createProviders(readConfig({ AI_PROVIDER: "groq" }), async (_url, options) => {
      const body = JSON.parse(options.body as string);
      expect(new TextEncoder().encode(body.messages.map((message: any) => message.content).join("")).length + 128).toBeLessThanOrEqual(6000);
      expect(body.max_completion_tokens).toBe(1024);
      expect(body.include_reasoning).toBe(false);
      expect(body).not.toHaveProperty("tools");
      expect(body.messages[1].content).toContain("untrustedSearchEvidence");
      return new Response(`data: ${JSON.stringify({ model: modelId, choices: [{ delta: { content: "Done" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    const sources = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: "Evidence", url: "https://example.org", snippet: "事实😹".repeat(250) }));
    for await (const _ of providers.answer("Question", sources, [], signal, modelId)) {}
  }
});

test("catalogue errors fail closed and a denied candidate is disabled without affecting other choices", async () => {
  let generationCalls = 0;
  const providers = createProviders(readConfig({ AI_PROVIDER: "groq" }), async (url) => {
    if (url.endsWith("/models")) return Response.json({ data: [
      { id: "openai/gpt-oss-20b" }, { id: "qwen/qwen3.8-27b" },
    ] });
    generationCalls++;
    return new Response(null, { status: 403 });
  });
  expect((await providers.models()).models[2]?.available).toBe(true);
  const denied = providers.answer("question", [{ id: 1, title: "Source", url: "https://example.org", snippet: "Evidence" }], [], signal, "qwen/qwen3.8-27b");
  await expect(denied.next()).rejects.toThrow();
  const catalogue = await providers.models();
  expect(catalogue.models[2]?.available).toBe(false);
  expect(catalogue.models[0]?.available).toBe(true);
  expect(generationCalls).toBe(1);
  let failedChecks = 0;
  await expect(createProviders(readConfig({ AI_PROVIDER: "groq" }), async () => {
    failedChecks++;
    return new Response(null, { status: 500 });
  }).models()).rejects.toThrow("could not be checked");
  expect(failedChecks).toBe(1);
});

test("a token cap inside optional suggestions preserves the confirmed answer, while unfinished answers still fail", async () => {
  for (const footer of [false,true]) {
    let calls=0;
    const providers=createProviders(readConfig({AI_PROVIDER:'groq'}),async()=>{
      calls++;
      return new Response(packets(
        'data: '+JSON.stringify({model:'openai/gpt-oss-20b',choices:[{delta:{content:'RSA uses primes [1].'}}]})+'\n\n'+
        (footer?'data: '+JSON.stringify({choices:[{delta:{content:'<|nuelexity_follow_ups_v1|>{"questions":'}}]})+'\n\n':'')+
        'data: '+JSON.stringify({choices:[{delta:{},finish_reason:'length'}]})+'\n\ndata: [DONE]\n\n'));
    });
    const collect=async()=>{const generation=providers.answer('RSA',[{id:1,title:'RSA',url:'https://example.test',snippet:'Primes'}],[],signal);while(true){const part=await generation.next();if(part.done)return part.value;}};
    if(footer) expect((await collect())?.id).toBe('openai/gpt-oss-20b');
    else await expect(collect()).rejects.toThrow('limit');
    expect(calls).toBe(1);
  }
});
