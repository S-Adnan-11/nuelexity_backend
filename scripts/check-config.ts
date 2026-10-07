import { readConfig } from "../lib/config";

// Metadata and zero-row reads only. This never searches, generates, or reserves quota.
// Print our own summaries; provider responses can contain private account details.
const config = readConfig();
let failures = 0;
function report(ok: boolean, name: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch {
    report(false, name, "connection or response failed; credentials and response bodies hidden");
  }
}
async function request(url: string, headers: Record<string, string>, options: RequestInit = {}) {
  return fetch(url, { ...options, headers, signal: AbortSignal.timeout(10000) });
}
function supabaseHeaders(key: string) {
  return { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) };
}

report(config.configured, "Required search settings", config.missingSettings.join(", "));
if (config.missingSettings.includes("GROQ_API_KEY") && process.env.GROK_API_KEY)
  console.log("FIX Rename GROK_API_KEY to GROQ_API_KEY; Groq and Grok are different providers.");
if (config.production)
  report(config.guestsEnabled, "Production guest protection", "TURNSTILE_SECRET_KEY required");
else
  console.log(
    "INFO Local development; Turnstile is optional here and required for production guests.",
  );

if (process.argv.includes("--remote")) {
  if (config.supabaseUrl && config.secret && config.publicKey) {
    const headers = supabaseHeaders(config.secret);
    await check("Supabase foundation metadata", async () => {
      const response = await request(`${config.supabaseUrl}/rest/v1/`, {
        ...headers,
        Accept: "application/openapi+json",
      });
      if (!response.ok) return report(false, "Supabase server key", `HTTP ${response.status}`);
      const schema = (await response.json()) as { paths?: Record<string, unknown> };
      const expected = [
        "/nuelexity_conversations",
        "/nuelexity_messages",
        "/nuelexity_usage",
        "/nuelexity_leases",
        "/rpc/nuelexity_reserve_request",
        "/rpc/nuelexity_release_request",
      ];
      const missing = expected.filter((path) => !schema.paths?.[path]);
      report(!missing.length, "Supabase foundation tables and quota functions", missing.join(", "));
    });
    await check("Supabase runtime readiness", async () => {
      const response = await request(
        `${config.supabaseUrl}/rest/v1/nuelexity_usage?select=subject&limit=0`,
        headers,
      );
      report(response.ok, "Supabase runtime readiness", `HTTP ${response.status}; no rows read`);
    });
    await check("Supabase browser restrictions", async () => {
      for (const table of [
        "users",
        "conversations",
        "messages",
        "nuelexity_usage",
        "nuelexity_leases",
      ]) {
        const response = await request(
          `${config.supabaseUrl}/rest/v1/${table}?select=*&limit=0`,
          supabaseHeaders(config.publicKey),
        );
        report(
          [401, 403].includes(response.status),
          `Anonymous access blocked for ${table}`,
          `HTTP ${response.status}; no rows read`,
        );
      }
    });
    await check("Supabase OAuth providers", async () => {
      const response = await request(
        `${config.supabaseUrl}/auth/v1/settings`,
        supabaseHeaders(config.publicKey),
      );
      if (!response.ok) return report(false, "Supabase public key", `HTTP ${response.status}`);
      const settings = (await response.json()) as { external?: Record<string, boolean> };
      for (const provider of ["google", "github"])
        report(settings.external?.[provider] === true, `Supabase ${provider} OAuth enabled`);
      console.log("INFO OAuth return URL allowlist still needs an actual browser sign-in check.");
    });
  } else report(false, "Supabase verification", "server/public settings missing");

  if (config.aiProvider === "groq" && config.groqKey) {
    await check("Groq key and selected model", async () => {
      const response = await request("https://api.groq.com/openai/v1/models", {
        Authorization: `Bearer ${config.groqKey}`,
      });
      if (!response.ok) return report(false, "Groq key", `HTTP ${response.status}`);
      const body = (await response.json()) as { data?: { id: string; active?: boolean }[] };
      report(
        !!body.data?.some((model) => model.id === config.groqModel && model.active !== false),
        "Groq key and selected model",
        "model listing only; no generation or token usage",
      );
      console.log("INFO Groq billing/free-plan status is only visible in the owner's dashboard.");
    });
  }
  if (config.tavilyKey) {
    await check("Tavily key and spending controls", async () => {
      const response = await request("https://api.tavily.com/usage", {
        Authorization: `Bearer ${config.tavilyKey}`,
      });
      if (!response.ok) return report(false, "Tavily key", `HTTP ${response.status}`);
      const body = (await response.json()) as {
        key?: { usage?: number; limit?: number | null };
        account?: {
          current_plan?: string;
          plan_usage?: number;
          plan_limit?: number;
          paygo_limit?: number | null;
          paygo_usage?: number;
        };
      };
      report(true, "Tavily key", "usage metadata only; no search credits spent");
      const account = body.account;
      report(account?.current_plan === "Researcher", "Tavily free Researcher plan");
      if (typeof account?.paygo_limit === "number")
        report(account.paygo_limit === 0, "Tavily pay-as-you-go limit is zero");
      else
        console.log(
          "CHECK Tavily pay-as-you-go limit is unspecified; confirm it is disabled in Billing.",
        );
      const remaining =
        typeof account?.plan_limit === "number" && typeof account.plan_usage === "number"
          ? Math.max(0, account.plan_limit - account.plan_usage)
          : null;
      if (remaining !== null)
        report(remaining > 0, "Tavily plan credits available", String(remaining));
      if (typeof body.key?.limit === "number" && typeof body.key.usage === "number")
        report(body.key.limit > body.key.usage, "Tavily key allowance available");
    });
  }
  if (config.turnstileSecret) {
    await check("Turnstile secret", async () => {
      const response = await request(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        { "Content-Type": "application/json" },
        {
          method: "POST",
          body: JSON.stringify({
            secret: config.turnstileSecret,
            response: "nuelexity-configuration-check",
          }),
        },
      );
      if (!response.ok) return report(false, "Turnstile secret", `HTTP ${response.status}`);
      const body = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
      const codes = body["error-codes"] || [];
      report(
        body.success === false &&
          codes.includes("invalid-input-response") &&
          !codes.includes("invalid-input-secret"),
        "Turnstile secret accepted and invalid token rejected",
      );
      console.log(
        "INFO A valid browser challenge must still verify the site-key pairing and allowed hostname.",
      );
    });
  } else
    console.log("INFO Turnstile secret is absent; production guest searches will be disabled.");
} else
  console.log(
    "INFO Add --remote for credential, schema, and provider metadata checks without search/model calls.",
  );

process.exitCode = failures ? 1 : 0;
