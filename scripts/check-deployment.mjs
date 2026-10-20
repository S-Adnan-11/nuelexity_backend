import assert from "node:assert/strict";

const url = new URL(process.argv[2] || "http://invalid");
if (url.protocol !== "https:" || !url.hostname.endsWith(".onrender.com") || url.pathname !== "/" || url.search || url.username || url.password)
  throw new Error("Pass the actual generated HTTPS Render origin, without a path or credentials.");
const origin = "https://nuelexity.devs.surf";
const end = Date.now() + 120000;
let live = false;
while (Date.now() < end) {
  try {
    const response = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(Math.min(8000, end - Date.now())) });
    live = response.ok && JSON.stringify(await response.json()) === '{"status":"ok"}';
  } catch {}
  if (live) break;
  await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(0, end - Date.now()))));
}
assert.ok(live, "health must return minimal JSON within the bounded startup window");
const request = (path, options = {}) => fetch(new URL(path, url), { ...options, signal: AbortSignal.timeout(10000) });
const ready = await request("/ready", { headers: { Origin: origin } });
assert.equal(ready.status, 200, "application readiness (already-applied Supabase schema/settings)");
assert.deepEqual(await ready.json(), { status: "ready" });
assert.equal(ready.headers.get("access-control-allow-origin"), origin);
assert.ok(ready.headers.get("cache-control").includes("no-store"));
const preflight = await request("/nuelexity_ask", { method: "OPTIONS", headers: {
  Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Authorization,X-Guest-Pass,Content-Type",
} });
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
assert.equal((await request("/health", { headers: { Origin: "https://disallowed.example" } })).status, 403);
for (const path of ["/requestlity_nuelexity", "/REQUESTLITY_NUELEXITY/"])
  assert.equal((await request(path, { method: "POST" })).status, 404);
const rejected = await request("/nuelexity_ask", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: '{"query":""}' });
assert.equal(rejected.status, 400, "invalid input rejected before auth, quotas or providers");
// A malformed supplied CF header must be replaced by managed ingress. This
// checks a boundary without publishing any IP/header echo or test endpoint.
const spoof = await request("/ready", { headers: { "CF-Connecting-IP": "not-an-ip", "X-Forwarded-For": "192.0.2.1", "True-Client-IP": "192.0.2.2" } });
assert.equal(spoof.status, 200, "Render must replace the supplied CF header with a valid client address");
console.log(`PASS ${url.origin}: HTTPS health/readiness, exact CORS, no-store, dummy denial, invalid ask, malformed forwarding-header rejection at ingress. No search, exchange, quota reservation or generation performed.`);
console.log("PENDING: valid-header spoof/pass continuity test and real HTTPS streaming/cancellation. Local compiled streaming uses fakes; no public fixture route exists.");
