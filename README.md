# Nuelexity backend

Render Free backend release preparation and exact dashboard fields are in [docs/RENDER_DEPLOYMENT.md](docs/RENDER_DEPLOYMENT.md). It uses the generated HTTPS hostname, one Free instance, minimal process health and bounded shared readiness. The frontend is prepared locally and will ship separately.

A Node.js/Express research API with Tavily retrieval, optional Groq answer streaming, Supabase OAuth verification, private conversation history, and durable free-tier quota enforcement.

## Run locally with npm

Use **Node.js 22.23.2 or newer in the 22 LTS line** and **npm 10.9–12**. `.nvmrc` pins 22.23.2; `engines` and `.npmrc` reject unsupported Node/npm versions. The existing React Router requires Node ≥22.22 and Supabase requires ≥22; this baseline also supports the selected Vite/Vitest tools. No Bun installation is needed.

For a standalone clone:

```bash
git clone https://github.com/S-Adnan-11/nuelexity_backend.git
cd nuelexity_backend
npm ci
npm run env:init
```

In the combined workspace, the exact backend directory is `backend/nuelexity_backend`; run all backend commands there. `env:init` creates `.env` from `.env.example` only when it is absent and preserves an existing file. Edit it with **your own** service credentials before starting:

```bash
npm run config:check
npm run dev
```

Open `http://localhost:3002/health`; readiness is `http://localhost:3002/ready`. In a second terminal, from the same parent directory that contains the standalone backend clone:

```bash
git clone https://github.com/S-Adnan-11/nuelexity_frontend.git
cd nuelexity_frontend
npm ci
npm run env:init
```

For the combined workspace, start that terminal at the workspace root and use `cd frontend/nuelexity_frontend` instead of cloning. Fill the frontend `.env` with your Supabase public URL/publishable key and `BUN_PUBLIC_BACKEND_URL=http://localhost:3002`, then run `npm run dev` and open `http://localhost:3000`. Ctrl+C stops either server; rerun its `npm run dev` to restart. Restart both after environment changes. Each repo has its own install and lockfile; there is no root npm install.

The API listens on port 3002. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `TAVILY_API_KEY`, and a stable `GUEST_ID_SECRET` of at least 32 characters. The existing server `NEXT_PUBLIC_SUPABASE_*` and `VITE_SUPABASE_*` names are accepted for compatibility; use the canonical names for new environments.

`AI_PROVIDER=none` returns real retrieved excerpts and spends no model credits. To synthesize streamed cited answers, set `AI_PROVIDER=groq` and `GROQ_API_KEY` from a Groq **Free** account. The default model is `openai/gpt-oss-20b`, verified in the configured account's active-model listing on 2026-10-07 and listed in [Groq's free-plan limits](https://console.groq.com/docs/rate-limits). GPT-OSS uses low reasoning effort and excludes reasoning from streamed responses. No paid gateway or automatic provider retries are used.

Software installation does not create a Supabase project, apply SQL, configure OAuth/Turnstile or supply API keys. For a **new** Supabase project, apply the additive [foundation migration](supabase/migrations/202610050001_research_foundation.sql) once in Supabase SQL Editor, then the [legacy hardening migration](supabase/migrations/202610060001_secure_legacy_tables.sql). Then apply [model selection](supabase/migrations/202610140001_model_selection.sql). Existing installations should verify their migration state rather than reapply SQL. Existing rows and enums are preserved; hardening blocks direct browser access to the old tables while the current app uses `nuelexity_` tables. See [database adoption](docs/DATABASE.md). Direct Postgres URLs and Prisma are not required for the runtime.

```bash
npm run check        # TypeScript, HTTP/provider tests, embedded Postgres/RLS tests, production build
npm run config:check # Missing setting names only; never prints keys
npm run config:check -- --remote # Credential/schema/usage metadata; no search/model credits
npm run db:inspect   # Read-only metadata via a direct connection, if available
npm run db:inspect-api  # Read-only metadata through HTTPS
```

`GET /health` is liveness; `GET /ready` verifies configuration and quota storage. All tests run without real credentials or provider calls. HTTP integration tests need localhost socket access.

If search reports incomplete setup, run `npm run config:check` and check the startup warning. Groq uses `GROQ_API_KEY` (Q), not `GROK_API_KEY` (K). Restart the backend after environment changes; restart the frontend after changing its public settings. Remote checks cannot prove OAuth redirect allowlists, a successful browser challenge, or the Groq billing plan. Tavily can return an unspecified pay-as-you-go limit; check Billing rather than treating this as proof of either enabled or disabled billing.

OAuth accounts live in `auth.users`. New conversations reference that Auth ID directly, so signing in does not insert a duplicate row into legacy `public.users`. Saved research appears in `nuelexity_conversations` and `nuelexity_messages`. See [user identity and legacy profiles](docs/DATABASE.md#user-identity-and-legacy-profiles).

Guest visitors complete Turnstile once and exchange it for an IP-bound server-signed pass. The frontend reuses it across refreshes in the same tab for at most two hours. Every search still passes durable quotas; a new guest ID cannot reset the IP-based allowance. See [guest session contract](docs/API.md#guest-verification-session). No dashboard change or database migration is required for this flow.

Signed-in users can select GPT-OSS 20B, GPT-OSS 120B, or Qwen 3.8 27B (Preview) near the chat composer. `GET /models` supplies the backend-approved catalogue; guests are restricted to `GROQ_MODEL`, currently GPT-OSS 20B. Per-request selection requires no restart. Conversation choices persist, each successful answer records the actual provider-confirmed model, and old answers display “Model unknown”. All choices share the existing quotas and 1024-token output cap; no fallback or automatic retry is used.

## Contextual follow-up questions

The same bounded Groq completion now produces an optional private suggestion footer after the answer. `app.ts` strips it before visible SSE deltas and saved text; `lib/follow-ups.ts` validates zero to three contextual questions. Missing, malformed, oversized, duplicate, previously asked or ungrounded suggestions become fewer questions or none. Sources-only/no-source results have none. Suggestions use the existing `follow_ups` column, so no migration is needed. The frontend displays them only with the corresponding completed answer and uses normal auth/guest/quota submission when selected.

The 6,000-byte combined input bound, 1,024-token total output cap, 12,000-character visible answer limit, deadlines and durable quotas remain. Footer instructions/metadata share those budgets, leaving less room for history/evidence and roughly 100–220 fewer answer tokens for typical English suggestions. No second generation, extra quota reservation, fallback or automatic retry is added. A token cap inside a recognized footer may preserve a completed, model-confirmed answer with `[DONE]`; a token cap before the boundary, missing confirmation or transport interruption remains a failure.

The existing `{questions: string[]}` SSE payload and stored model/provider provenance remain unchanged. Visible answer labels now omit the provider suffix; historical records are not rewritten. Offline fixtures cover separation, persistence, multi-turn/French examples and invalid output. They do not establish live suggestion quality, which remains unverified.

## Current model-selection adoption

All three candidates passed the earlier bounded live generation checks with the existing key. On 2026-10-15, the read-only schema diagnostic (now `npm run schema:check`) confirmed HTTP 200 zero-row access to quota storage and the selection/attribution columns. The older missing-column blocker is cleared; do not rerun migrations based on that old note. The [read-only SQL verification](supabase/verification/202610140001_model_selection.sql) can audit constraints/RLS separately; this session did not mutate or inspect conversation rows. Existing environment values, the Free account and Turnstile setup stay as configured. See [adoption status and owner review](docs/MODEL_SELECTION.md).

## First-time deployment configuration reference

1. On a new project, run the three migrations above in order in the correct Supabase project. Verify legacy table RLS with the read-only audit in `docs/DATABASE.md`. Do not rerun the historical destructive migration 2.
2. In Supabase Auth, enable Google/GitHub and allow `http://localhost:3000/auth/callback` plus your future deployed callback URL. Provider application callback URLs point to Supabase's `/auth/v1/callback`, not directly to Nuelexity. Keep provider OAuth client secrets in Supabase, not the browser.
3. Keep Tavily on its Free plan with pay-as-you-go disabled. Keep Groq on Free if using it; keys shared with other apps consume the same provider allowance. Review free-tier data policies before sensitive searches.
4. Before enabling public guest access, configure Cloudflare Turnstile: backend `TURNSTILE_SECRET_KEY`, frontend `BUN_PUBLIC_TURNSTILE_SITE_KEY`, and approved frontend hostnames. Production guests fail closed when bot protection is absent.
5. Configure exact `FRONTEND_ORIGINS`, HTTPS URLs, and a trustworthy reverse proxy. `TRUST_PROXY_HOPS=0` is correct locally. Set a nonzero fixed hop count only if direct access is blocked and all incoming requests traverse that known proxy chain.

Default limits: guest 2/day, user 5/day, IP 10/day, entire app 25/day and 800/month, plus 4/minute and one active request per identity. Calendar resets use UTC. Requests have a 60-second deadline. Failed/cancelled reservations remain consumed because upstream work may already have happened. The preserved dummy endpoint does not call providers.

## Architecture and collaboration

- `index.ts`: startup and the untouched `/requestlity_nuelexity` dummy handler.
- `app.ts`: HTTP validation, auth, SSE lifecycle, limits and owned conversation routes.
- `lib/store.ts`: Supabase Data API and service-only quota RPCs.
- `lib/providers.ts`: Tavily basic search, Groq streaming, honest sources-only mode, guest verification.
- `supabase/migrations`: active SQL source of truth. `prisma/schema.prisma` is legacy reference.
- [API contract](docs/API.md), [review/plan](docs/PROJECT_REVIEW.md).

`maadan-dev` owns frontend refinement; coordinate API/event changes before updating frontend requests. Changes are local and reviewable; no teammate messages, Git pushes, or deployments are performed by these scripts.

Provider references: [Tavily credits](https://docs.tavily.com/documentation/api-credits), [Groq limits](https://console.groq.com/docs/rate-limits), [Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## Build, test and production startup

```bash
npm run typecheck
npm test
npm run build
npm run test:startup
npm start
```

`dev` uses Node watch mode with `tsx`. `build` emits native ESM JavaScript in `dist/`; `start` runs that JavaScript with Node and sets production mode. After building, `npm prune --omit=dev` and `npm start` work without TypeScript, tsx, Vitest or Bun. A deployment needs `dist/`, `package.json`, `package-lock.json`, `scripts/{production-env,env,load-env}.mjs`, its runtime dependencies (`npm ci --omit=dev`) and its own server environment. Build before omitting dev dependencies. Ctrl+C or SIGTERM closes the HTTP server with a bounded shutdown; rerun `npm start` to restart. Reinstall with `npm ci` before developing/building after a production-only install.

Node explicitly loads `.env.local`, `.env.production` (production build/start) or `.env.development` (dev/utilities), then `.env`. Existing process settings take priority. Tests do not load developer environment files. Utilities require the normal development install. `npm run schema:check` performs zero-row reads; `npm run db:inspect` and `npm run db:inspect-api` inspect metadata only. `npm run models:check` exits without generation unless explicitly passed `-- --live`; that diagnostic consumes provider quota and is excluded from every check/CI command.

All ordinary tests fake external services. `npm run test:startup` checks the compiled server, fail-closed readiness, CORS, preserved dummy SSE and graceful shutdown with no credentials. With Chrome/Chromium available and the sibling frontend built, `npm run test:browser` tests the **real compiled Node API and production React UI** with injected fake services: streaming, split/malformed follow-up metadata, contextual follow-up and Stop/abort propagation. For another layout, pass `npm run test:browser -- /absolute/path/to/frontend/dist`; set `CHROME_BIN` to your browser executable if needed. Chrome is only an extra prerequisite for browser tests, not installation/build/server operation.

See [Node/npm audit and verification](NPM_SUPPORT.md). GitHub Actions uses Node, `npm ci`, checks and production startup after pruning dev dependencies. Local results do not mean hosted CI has run.

## Optional Bun package manager

With Node/npm still installed, Bun 1.4.0 can install and invoke the same scripts:

```bash
bun install --no-save
bun run check
bun run dev
```

`package-lock.json` is the only committed lockfile and the reproducible install/CI contract is `npm ci`. Bun imports that lockfile. Its generated `bun.lock` is local/ignored; it is not a second source of truth. Before reinstalling with Bun after npm dependency edits, remove the local Bun lock with `node -e "require('node:fs').rmSync('bun.lock', {force:true})"` so it imports the current npm lock. Do not use `bun test` or run the old TypeScript/Bun server directly. The supported runtime is Node, including when scripts are invoked by Bun. After dependency changes, use `npm install`, commit `package.json` and `package-lock.json` together, and verify `npm ci`; do not commit generated Bun locks.

## Predeployment review

See [data/storage inventory and policy assumptions](docs/DATA_INVENTORY.md), [threat model and launch checklist](docs/THREAT_MODEL.md) and frontend [local delivery/owner actions](../../frontend/nuelexity_frontend/docs/PREDEPLOYMENT.md). No new SQL is required for this milestone. Keep already-applied migrations intact.

`MAX_INFLIGHT_REQUESTS` defaults to 8 active non-health requests per process (1–32). Overload returns 503/Retry-After; guest exchanges also have <=4 active verification requests and 6 attempts/IP/minute. These memory guards complement atomic database search quotas and do not coordinate replicas. Use one small beta instance until shared verification/auth rate protection and actual host limits are reviewed. Production denies `/requestlity_nuelexity` without editing its preserved development handler. SSE respects client backpressure and sends private/no-store/no-transform headers. Provider JSON is bounded before parsing.
