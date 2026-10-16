# Conversation model selection — 2026-10-14

The historical verification below originally used Bun; runnable command examples now use the supported npm workflow. See the backend `NPM_SUPPORT.md` for the Node migration results.
## Implemented behavior

The backend catalogue in `lib/models.ts` approves exactly these candidates:

| ID | Display label | Status | Live generation check |
| --- | --- | --- | --- |
| `openai/gpt-oss-20b` | GPT-OSS 20B | Production; current backend default | HTTP 200; completed; actual ID confirmed |
| `openai/gpt-oss-120b` | GPT-OSS 120B | Production | HTTP 200; completed; actual ID confirmed |
| `qwen/qwen3.8-27b` | Qwen 3.8 27B | Preview | HTTP 200; completed; actual ID confirmed |

These labels and Preview flags are served to the frontend through `GET /models`. The catalogue intersects this allowlist with cached active-model metadata. It never offers arbitrary provider models. Groq serves the models; OpenAI and Qwen are their respective creators. Preview availability may change.

Signed-in access comes from Supabase's verified server-side identity. The selector near the composer is a labelled native select with keyboard operation, mobile wrapping and a visible focus indicator. Guests see a disabled default model and a sign-in hint; the backend rejects alternate model overrides. A signed guest pass is bot clearance, not account authentication.

Each existing conversation stores its next model choice through an owner-filtered PUT endpoint. Changes during generation affect the next submission. Selection writes are serialized; an unsaved choice blocks generation and offers a manual save retry. New threads start with the configured backend default; choosing another model before the first message stores that choice when the conversation is created. Refresh restores the active thread from a per-user, per-tab ID pointer, then loads its selection and messages from the backend. Reopening from the library also loads the saved choice. Sign-out cancels work and returns to guest/default behavior.

The request sends a frozen `modelId`; the provider response must confirm that exact ID, finish successfully, and end with `[DONE]`. Only then is `{id,name,provider,preview}` recorded with the successful assistant answer. Previous labels are message snapshots, independent of the next choice or current catalogue. Older rows remain NULL and display **Model unknown**. Failed/streaming answers do not claim a successful model. Explicit sources-only and no-source results display that no model was used. Retired/unavailable saved IDs stay visible and block submission until an available choice is selected. No model fallback or automatic generation retry exists.

## Actual integration and budget policy

The inspected checkout has an injected provider architecture with direct HTTP adapters, not an installed AI SDK dependency. The production route remains:

`POST /nuelexity_ask` → verified Supabase auth / guest IP-bound Turnstile pass → owned conversation + model validation → durable quota reservation → one Tavily basic search → `lib/providers.ts` → `POST https://api.groq.com/openai/v1/chat/completions` → SSE completion + owned persistence.

`AI_PROVIDER=groq` enables this route. `GROQ_MODEL` remains the configured default, verified as `openai/gpt-oss-20b`. The adapter receives each request's ID directly, so switching models needs no backend restart. Secrets and existing environment values were not edited. The key stays in backend Authorization headers. The entire `/requestlity_nuelexity` dummy handler is unchanged.

Account, guest/IP, global daily/monthly/minute ceilings, one active-request lease, the 60-second deadline, request/history/source/answer bounds, Turnstile validation and failed-attempt accounting remain in force. All models use the same quota subject; changing models reserves no new allowance and cannot reset counters. Failed/cancelled generations retain their reservation.

The output cap remains 1,024 tokens for every candidate, below their published completion limits. Input is additionally limited to 6,000 combined UTF-8 bytes including 128 bytes reserved for framing. Oldest bounded history is removed first, then source excerpts shortened until the prompt fits; the question and evidence from every source remain. Questions that cannot fit return a recoverable input-limit error. The existing accounting policy counts durable requests; this change does not introduce a durable token ledger. This conservative per-request bound does not promise to prevent every organization-level TPM/TPD rate limit. Groq 429, 403/404, provider failures, token limits and interrupted streams are recoverable failures with no automatic fallback.

Current official documentation checked for this implementation:

- [Supported models](https://console.groq.com/docs/models): both GPT-OSS candidates are production models; Qwen 3.8 27B is Preview. All have 131,072-token contexts; Qwen's completion limit is 16,384, GPT-OSS's 65,536.
- [Rate limits](https://console.groq.com/docs/rate-limits): published Free base limits for each candidate are 30 RPM, 1,000 RPD, 8,000 TPM and 200,000 TPD; organization exceptions and remaining allowance still apply.
- [Model permissions](https://console.groq.com/docs/model-permissions): organization/project restrictions cascade and restricted requests return 403. Metadata listing alone does not prove generation permission.

No paid gateway, fallback, retry, deployment, account upgrade, or teammate contact was introduced. The owner had already confirmed the account is Free; the API model listing cannot independently verify billing tier.

## Verification evidence and limits

- Backend `npm run check`: typecheck and 70 offline tests pass, including real provider request construction with fake HTTP, authenticated model routing, guest/unknown rejection, saved choices, immutable prior labels, in-flight changes, shared quotas, ownership, provider errors, and additive migration/RLS checks plus the exact owner verification SQL in embedded PostgreSQL.
- Frontend `npm run check`: typecheck, 14 fake-stream/config/model tests and the production build pass.
- Frontend `npm run test:browser` (after build): headless Chrome loads the production bundle against local fake auth/provider endpoints. Desktop/mobile and keyboard selection/Tab, refresh/reopening, defaults, in-flight freezing, old attribution, failed saves, retired selections, permission/interruption/quota recovery and sign-out pass. It consumes no real provider credits. Set `CHROME_BIN` if Chrome is installed elsewhere.
- Live Groq checks used the existing key: exactly one generation per candidate, each with a 128-output-token cap, a tiny synthetic verification source, a 20-second timeout, no Tavily calls and no retries. Each returned HTTP 200 and completed with the requested model ID. These three checks consumed three retained durable request reservations under a stable owner-diagnostic identity, including IP/global ceilings. No private chat content or generated text was printed.
- A separate live model-list check confirmed the new catalogue parser sees all three candidates. That metadata check is not the generation-access evidence; the three completed calls above are.
- Updated 2026-10-15: the schema diagnostic (now `npm run schema:check`) returned HTTP 200 with `ready: true` for quota storage, `selected_model` and message `model,answer_kind`, using zero-row reads. This supersedes the earlier missing-column result and clears that schema blocker. No migration was applied in this verification, no private rows were read, and remote constraints/RLS or a real authenticated persistence flow were not re-audited. Real OAuth and Turnstile pairing still need deployment-origin verification.

`scripts/check-model-generation.ts --live` is an explicit diagnostic that consumes up to three new reservations and calls. Do not rerun it as an ordinary test. All normal tests use fakes.

## Adoption status and new-project setup

The configured project now exposes the required columns. Do not rerun the migration because of the earlier missing-column note. All three candidates passed the earlier checks with the existing key; no Groq permission change is identified. Keep the account on Free. The following steps are retained for a genuinely new project or a verified missing schema; existing projects can run the read-only verification steps.

1. In the existing Supabase project's **SQL Editor**, review and run the complete file `supabase/migrations/202610140001_model_selection.sql` exactly once. The foundation must already exist. The migration adds `selected_model` to `nuelexity_conversations`, plus nullable `model`/`answer_kind` columns and constraints to `nuelexity_messages`. It preserves every row and all existing ownership policies/quotas. It does not modify legacy tables, backfill historical model claims, or require Prisma. Do not run a reset or schema push.
2. Run the complete read-only file `supabase/verification/202610140001_model_selection.sql` in SQL Editor. Expect three nullable columns, three message constraints, both RLS flags true, and browser UPDATE/INSERT privileges false. The migration requests PostgREST schema reload; if SQL is correct but the Data API still reports missing columns, run `notify pgrst, 'reload schema';` and verify again.
3. From the backend repository, run `npm run schema:check`. Expect all three zero-row checks to report `ready: true`. With the updated backend running, `GET /ready` should return 200. No generation or quota reservation occurs in this schema check. Readiness intentionally fails closed while the columns are absent.
4. Use the local updated frontend/backend to complete the manual review below. Adoption of the new code should follow migration verification. There is no new environment variable, credential, paid plan, or hosting setup required for this feature.

If an account restriction appears later, the error names the affected model. Only then review organization/project model permissions for that specific ID, following the official permissions link above; never solve it with a paid model or fallback.

## Short owner review checklist

- Signed in: select GPT-OSS 120B, submit a short question, then select Qwen Preview for the follow-up. Confirm each successful answer keeps its actual model name and Preview flag without a provider suffix; provider metadata remains stored internally.
- While an answer runs, change the selector. Confirm the running answer's label stays fixed and the next message uses the new choice.
- Refresh and reopen the saved conversation. Confirm its selection and earlier labels remain. Open an older thread: messages without recorded metadata must say “Model unknown”. New search starts at GPT-OSS 20B.
- On desktop and mobile, Tab to the selector, use arrow keys, and submit with Enter. Verify Preview/sign-in/unavailable hints remain readable. Stop a stream and confirm it stays incomplete without a success model claim.
- Sign out: confirm the selector is disabled at the backend default. Confirm normal guest verification/search still works within the existing allowance; switching signed-in models must not restore used searches.

For removal/permission/rate-limit cases, use the local browser/offline tests rather than spending real credits or changing account permissions solely to induce a failure.





nxt hand off..
