import { createHmac, randomUUID } from "node:crypto";
import { readConfig } from "../lib/config";
import { createStore } from "../lib/store";
import { createProviders } from "../lib/providers";
import { APPROVED_MODELS } from "../lib/models";
import { AppError } from "../lib/errors";

// Explicit operator diagnostic only. Running this consumes up to three durable
// reservations and one <=128-output-token Groq request per approved model.
// No Tavily requests, retries, model fallback, or billing changes.
if (!process.argv.includes("--live")) {
  console.log("Add --live to run at most one bounded Groq generation per approved model.");
  process.exit(0);
}
const config = readConfig();
console.log(JSON.stringify({ aiProvider: config.aiProvider, defaultModelId: config.groqModel, configured: config.configured }));
if (!config.configured || config.aiProvider !== "groq") process.exit(1);
const store = createStore(config);
const ipHash = createHmac("sha256", config.guestSecret).update("local-owner-model-verification").digest("hex");
// The local owner uses the signed-in daily ceiling; account/IP/global budgets
// still apply. This diagnostic identity grants no application authentication.
const identity = { subject: "user:owner-model-verification", userId: "owner-model-verification", ipHash };
let httpStatus: number | null = null;
const providers = createProviders(config, async (url, options) => {
  const response = await fetch(url, options);
  if (url.endsWith("/chat/completions")) {
    httpStatus = response.status;
    console.log(JSON.stringify({
      route: "https://api.groq.com/openai/v1/chat/completions",
      httpStatus,
      remainingRequests: response.headers.get("x-ratelimit-remaining-requests"),
      remainingTokens: response.headers.get("x-ratelimit-remaining-tokens"),
    }));
  }
  return response;
});
// Read migration metadata without touching rows; do not block isolated provider
// verification on an unapplied attribution migration. Quotas must exist.
try {
  await store.ready();
  console.log("Attribution migration: ready (zero-row checks).");
} catch {
  console.log("Attribution migration: not verified; live checks still require durable quota reservations.");
}
for (const model of APPROVED_MODELS) {
  const requestId = randomUUID();
  let reserved = false;
  httpStatus = null;
  try {
    const reservation = await store.reserve(identity, requestId);
    if (!reservation.allowed) {
      console.log(JSON.stringify({ modelId: model.id, result: "skipped", reason: reservation.code || "quota-denied" }));
      continue;
    }
    reserved = true;
    const generation = providers.answer("Confirm the supplied verification evidence in one short word.",
      [{ id: 1, title: "Verification", url: "https://example.org", snippet: "The verification status is OK." }],
      [], AbortSignal.timeout(20000), model.id, 128);
    let characters = 0;
    while (true) {
      const chunk = await generation.next();
      if (chunk.done) {
        console.log(JSON.stringify({ modelId: model.id, result: "completed", actualModelId: chunk.value?.id ?? null, characters }));
        break;
      }
      characters += chunk.value.length;
    }
  } catch (error) {
    console.log(JSON.stringify({ modelId: model.id, result: "failed", httpStatus,
      code: error instanceof AppError ? error.code : "CONNECTION_OR_DATABASE_UNAVAILABLE" }));
  } finally {
    if (reserved) await store.release(identity.subject, requestId).catch(() => {});
  }
}
