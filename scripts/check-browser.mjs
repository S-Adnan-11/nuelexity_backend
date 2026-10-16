import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../dist/app.js";
import { readConfig } from "../dist/lib/config.js";
import { APPROVED_MODELS, modelCatalogue } from "../dist/lib/models.js";
import { FOLLOW_UP_MARKER } from "../dist/lib/follow-ups.js";

// Real compiled HTTP/SSE handlers and real frontend bundle; only services are faked.
const frontend = path.resolve(process.argv[2] || "../../frontend/nuelexity_frontend/dist");
await readFile(path.join(frontend, "index.html"));
const config = readConfig({ SUPABASE_URL: "https://fixture.invalid", SUPABASE_SECRET_KEY: "fixture",
  SUPABASE_PUBLISHABLE_KEY: "fixture", TAVILY_API_KEY: "fixture", GROQ_API_KEY: "fixture", AI_PROVIDER: "groq",
  GUEST_ID_SECRET: "offline-fixture-secret-32-characters", FRONTEND_ORIGINS: "http://localhost:3000" });
let reservations = 0, releases = 0, answers = 0, aborted = false, mode = "valid";
const histories = [];
const question = "How does RSA key generation use prime numbers?";
const text = "RSA key generation uses prime numbers and modular arithmetic [1].";
const source = { id: 1, title: "RSA key generation", url: "https://example.test/rsa", snippet: text };
const unexpected = async () => { throw new Error("Unexpected private-store access in guest fixture"); };
const app = createApp({ config, store: {
  ready: async () => {}, reserve: async () => { reservations++; return { allowed: true, remaining: 4 }; },
  release: async () => { releases++; }, verifyToken: unexpected, list: unexpected, detail: unexpected,
  remove: unexpected, create: unexpected, setModel: unexpected, save: unexpected,
}, providers: {
  models: async () => modelCatalogue(config, new Set(APPROVED_MODELS.map(model => model.id))),
  search: async () => [source], verifyGuest: async () => {},
  answer: async function* (_query, _sources, history, signal) {
    answers++; histories.push(history);
    yield "RSA key generation ";
    if (mode === "cancel") {
      await new Promise(resolve => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
      signal.throwIfAborted();
    }
    await delay(150, undefined, { signal });
    yield "uses prime numbers and modular arithmetic [1].\n";
    // Split the metadata delimiter and payload across actual HTTP stream chunks.
    const footer = FOLLOW_UP_MARKER + (mode === "malformed" ? '{"questions":' : JSON.stringify({ questions: [{ question, anchor: "key generation" }] }));
    for (let i = 0; i < footer.length; i += 3) yield footer.slice(i, i + 3);
    return { ...APPROVED_MODELS[0], provider: "Groq" };
  },
} });
let base;
app.get("/config.json", (_req, res) => res.json({ BUN_PUBLIC_BACKEND_URL: base,
  BUN_PUBLIC_SUPABASE_URL: base + "/supabase", BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline-fixture",
  BUN_PUBLIC_TURNSTILE_SITE_KEY: "" }));
app.use(express.static(frontend));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(frontend, "index.html")));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
base = `http://127.0.0.1:${server.address().port}`;
config.origins.push(base);
const profile = await mkdtemp(path.join(tmpdir(), "nuelexity-node-browser-"));
const chrome = spawn(process.env.CHROME_BIN || "google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const chromeExited = once(chrome, "exit");
let socket, sequence = 0;
const pending = new Map();
async function until(run, label) {
  for (let i = 0; i < 250; i++) { if (await run()) return; await delay(40); }
  throw new Error(`Timed out: ${label}`);
}
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!result.exceptionDetails, "browser expression");
  return result.result.value;
}
async function submit(query) {
  await evaluate(`(() => { const i=document.querySelector('#question'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(i,${JSON.stringify(query)}); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await until(() => evaluate("document.querySelector('[aria-label=\"Send question\"]')?.disabled === false"), "send enabled");
  await evaluate("document.querySelector('[aria-label=\"Send question\"]').click()");
}
try {
  assert.equal((await fetch(base + "/ready")).status, 200);
  let port;
  await until(async () => { try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; return !!port; } catch { return false; } }, "Chrome startup");
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  socket.onmessage = event => {
    const packet = JSON.parse(String(event.data)), waiter = pending.get(packet.id);
    if (!waiter) return;
    pending.delete(packet.id);
    if (packet.error) waiter.reject(new Error(packet.error.message)); else waiter.resolve(packet.result);
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  await command("Page.enable");
  await command("Page.navigate", { url: base });
  await until(() => evaluate("!!document.querySelector('#question')"), "real research UI");
  await submit("Explain RSA key generation");
  await until(() => evaluate("!!document.querySelector('[aria-label=\"Stop search\"]')"), "live Node stream");
  await until(() => evaluate(`document.body.innerText.includes(${JSON.stringify(question)})`), "validated follow-up metadata");
  assert.equal(await evaluate("document.body.innerText.includes('nuelexity_follow_ups')"), false);
  assert.ok(await evaluate("!!document.querySelector('.citation')"));
  mode = "malformed";
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(question)})).click()`);
  await until(() => Promise.resolve(answers === 2 && releases === 2), "contextual second answer");
  assert.ok(histories[1].some(message => message.role === "user" && message.content.includes("RSA")));
  assert.ok(histories[1].some(message => message.role === "assistant" && message.content.includes("prime numbers")));
  await until(() => evaluate("!document.querySelector('[aria-label=\"Stop search\"]')"), "malformed optional footer still completes");
  assert.equal(await evaluate("document.body.innerText.includes('nuelexity_follow_ups')"), false);
  mode = "cancel";
  await submit("Explain RSA cancellation");
  await until(() => Promise.resolve(answers === 3), "pending provider");
  await evaluate("document.querySelector('[aria-label=\"Stop search\"]').click()");
  await until(() => Promise.resolve(aborted && releases === 3), "browser abort reaches Node provider and releases lease");
  await until(() => evaluate("document.body.innerText.includes('Incomplete')"), "truthful cancelled state");
  assert.equal(reservations, 3);
  assert.equal(answers, 3);
  console.log("PASS real Node backend + production browser: streaming, citations, split/invalid metadata, contextual follow-up, Stop/abort, one reservation per request. Services faked; zero credits.");
} finally {
  socket?.close(); chrome.kill(); await chromeExited;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
