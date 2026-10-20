import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = String(probe.address().port);
await new Promise(resolve => probe.close(resolve));
// No local credentials or provider requests. This also works after omit=dev.
const child = spawn(process.execPath, ["--import", "./scripts/production-env.mjs", "dist/index.js"], {
  env: { PATH: process.env.PATH, NUELEXITY_ENV_FILE: "none", PORT: port }, stdio: "ignore",
});
const exited = once(child, "exit");
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(base + "/health")).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, "compiled Node backend startup");
  assert.equal((await fetch(base + "/health")).status, 200);
  assert.deepEqual(await (await fetch(base + "/health")).json(), { status: "ok" });
  assert.equal((await fetch(base + "/ready")).status, 503);
  const cors = await fetch(base + "/nuelexity_ask", { method: "OPTIONS", headers: {
    Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "Authorization,X-Guest-Pass,Content-Type",
  } });
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const dummy = await fetch(base + "/requestlity_nuelexity", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dummy: "offline-smoke" }) });
  assert.equal(dummy.status, 404);
  assert.equal((await fetch(base + '/REQUESTLITY_NUELEXITY/', { method: 'POST' })).status, 404);
  assert.equal((await dummy.json()).error.code, "NOT_FOUND");
  console.log("PASS compiled Node backend: health, fail-closed readiness, CORS, production dummy blocked (handler preserved).");
} finally {
  child.kill();
  const [code, signal] = await exited;
  assert.equal(code, 0, `graceful shutdown: ${signal}`);
}
