import { readConfig } from "../lib/config.js";

// Zero-row reads only, with fixed summaries. Never print database responses.
const config = readConfig();
if (!config.supabaseUrl || !config.secret) {
  console.log("Model schema verification requires the existing Supabase server configuration.");
  process.exit(1);
}
let failed = false;
for (const [table, columns] of [
  ["nuelexity_usage", "subject"],
  ["nuelexity_conversations", "selected_model"],
  ["nuelexity_messages", "model,answer_kind"],
]) {
  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${table}?select=${columns}&limit=0`, {
      headers: { apikey: config.secret, ...(config.secret.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${config.secret}` }) },
      signal: AbortSignal.timeout(10000),
    });
    const code = response.ok ? null : (await response.json().catch(() => ({})) as { code?: string }).code;
    failed ||= !response.ok;
    console.log(JSON.stringify({ table, columns, ready: response.ok, status: response.status,
      missingColumn: code === "42703" || code === "PGRST204" }));
  } catch {
    failed = true;
    console.log(JSON.stringify({ table, ready: false, reason: "connection-unavailable" }));
  }
}
process.exitCode = failed ? 1 : 0;
