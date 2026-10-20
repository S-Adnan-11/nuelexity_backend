# Render backend release — 2026-10-20

## Cold-start plan recorded before implementation

Trace of the current search interface, after Supabase browser session restoration:

| Entry | Existing early API requests | Verification |
| --- | --- | --- |
| New guest | `GET /guest/session`, `GET /models` | Session check shows Turnstile; its successful callback immediately POSTs the single-use token to `/guest/session`, saving a two-hour signed IP-bound pass before search |
| Returning guest | Same two GETs, session check carries stored `X-Guest-Pass` | Valid pass hides Turnstile; expiry/IP change requires a fresh challenge |
| Signed in | Bearer `GET /models`, `GET /conversations`; saved URL/tab pointer also GETs owned thread detail | Supabase verifies Bearer; no guest exchange |

Full network boundaries on opening: the frontend serves its document, scripts/styles/local fonts and `GET /config.json` before mounting search. Supabase session restoration reads browser storage; an expired session can refresh against Supabase Auth directly, independently of the backend. Signed-in avatars can contact the supplied HTTPS image host. These requests cannot wake the separate Render backend.

The current API boundary sets JSON Content-Type even on GETs; cross-origin browsers therefore normally send CORS `OPTIONS` before the first API read, also for Bearer/X-Guest-Pass headers (a cached preflight can omit it). That existing preflight can be the very first Render wake request. Fetch includes it in the shared operation; startup HTML or failed preflight may surface as a network/CORS error, handled by bounded safe-read backoff. No duplicate explicit OPTIONS or wake request is added. `/ready` and the fallback health probe use simple GETs without auth/custom headers.

Behind those reads, `/models` can verify Bearer through Supabase Auth and read Groq's cached free model metadata; `/conversations`/thread detail verify Bearer and read owned storage. `/guest/session` GET checks settings and HMAC only. None reserves quota, retrieves Tavily results or generates an answer. A guest needing verification then loads Cloudflare's script/challenge frames and sends one POST exchange (plus its browser-managed CORS preflight); Siteverify occurs server-side only at that exchange. A returning valid pass skips the widget/exchange. Search itself remains an explicitly submitted POST after the normal checks. Browser-requested icons/manifest and ordinary local navigation assets remain frontend-host requests, not backend wake traffic.

All current entry paths already wake the backend. Reuse the first safe GET in one shared frontend startup operation, retain its response, and hold other reads until readiness. Only an entry with no existing early read uses `/health`. A short per-attempt timeout, bounded exponential backoff and a total startup deadline handle platform HTML/non-JSON/network errors. Stop polling after success, terminal configuration failure, timeout or unmount. No scheduled pings. Never retry POST exchanges or searches automatically.

`/health` will return only `{status:"ok"}`: no store/provider calls, writes, quota or diagnostics. `/ready` separately checks settings and required zero-row table access with a total deadline, one in-flight check and cached success/failure. Neither probes Groq/Tavily/Cloudflare. Failed readiness is distinct from missing configuration and unreachable platform responses.

Drafting remains available. Explicit Send freezes one pending question without clearing the draft; Cancel abandons it. Only after readiness, available model and ordinary auth/guest verification may it issue one search. Navigation, sign-out and account replacement cancel waiting work. Once search is dispatched its acceptance may be uncertain: preserve the draft, mark incomplete, require a new manual submission. Startup time is outside the normal answer deadline. Expired Turnstile proof requires a fresh challenge; never re-exchange a consumed token.

Render can wake on public traffic before any application check. This plan reduces visible waiting; it neither eliminates cold starts nor supplies infrastructure traffic protection.

## Owner-confirmed scope

Render Free Web Service, one instance, generated HTTPS hostname, no backend custom domain. Frontend later at `https://nuelexity.devs.surf`; public learning beta accessible to anyone, subject to small shared allowances. Developer: Adnan Muhammad Sadiq, [GitHub](https://github.com/S-Adnan-11), [portfolio](https://s-adnan.dev). Confirmed support/privacy: `s.adnan.werk@gmail.com`. No frontend deployment in this release.

## Exact release and dashboard setup

Repository: `https://github.com/S-Adnan-11/nuelexity_backend`, branch **`release/render-free`**. Both working trees were dirty, so neither was pulled or overwritten. The backend release includes the reviewed existing reliability/security prerequisites (especially production dummy denial); the frontend stays local. The branch includes the two existing local Node/npm/documentation commits on top of upstream `8df941d`. No frontend repository is pushed.

First owner step when no connected Render account is available: open [Render Dashboard](https://dashboard.render.com/), choose **New → Web Service → Git Provider**, connect GitHub if needed, and select **S-Adnan-11/nuelexity_backend**. Use these fields:

| Field | Exact setting |
| --- | --- |
| Name | `nuelexity-backend` (accept a generated suffix if unavailable) |
| Branch | `release/render-free`; check the release commit against this report |
| Region | Frankfurt, as prepared in `render.yaml`; record the actual selection for the privacy review |
| Language/runtime | Node |
| Root Directory | Leave blank: this Git repository already IS the backend |
| Build Command | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Start Command | `npm start` |
| Instance Type | **Free**, exactly one instance |
| Health Check Path | `/health` |
| Auto-Deploy | **Off** (manual deploy of the reviewed commit) |
| Shutdown delay | 15 seconds; application force-exit ceiling is 10 seconds |
| Custom domains, disk, new database, cron, pre-deploy/migration command | None |

`render.yaml` is also a backend-only Blueprint with these settings. Use either the manual form or a Blueprint, not both. No paid resource, autoscaler or keep-alive is defined. `dist/index.js` is native ESM emitted by `npm run build`; `npm start` preloads `scripts/production-env.mjs`. Keep `scripts/env.mjs` and `scripts/load-env.mjs` in the release. Runtime dependencies are only Express, cors and zod; TypeScript, tsx and database/test tools are build/development dependencies. Node 22.23.2 is pinned in `.nvmrc`/`NODE_VERSION`; supported engines remain Node 22.23.2+ <23 and npm 10.9–12. Bun remains an optional package-manager dispatcher, not the production runtime.

Before **Create Web Service**, enter these settings in Render's private Environment UI. Do not paste values into an issue, report or terminal transcript; do not upload the entire local `.env`.

| Names | Values / handling |
| --- | --- |
| `NODE_VERSION`, `NODE_ENV`, `NUELEXITY_ENV_FILE` | `22.23.2`, `production`, `none` |
| `SKIP_INSTALL_DEPS` | `true` (the explicit build command performs the canonical npm install) |
| `FRONTEND_ORIGINS` | `https://nuelexity.devs.surf` (only append deliberate development origins if needed) |
| `CLIENT_IP_MODE`, `TRUST_PROXY_HOPS` | `render`, `0`; Render supplies its own `RENDER=true` runtime marker |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Copy the existing project settings privately, preserving the existing service credential |
| `GUEST_ID_SECRET` | Copy the **existing stable value** privately; no generation or rotation |
| `TURNSTILE_SECRET_KEY`, `TAVILY_API_KEY`, `GROQ_API_KEY` | Existing keys; real production Turnstile pair, Tavily pay-as-you-go OFF, Groq Free |
| `AI_PROVIDER`, `GROQ_MODEL` | `groq`, `openai/gpt-oss-20b` for the existing AI setup; `none` is an explicit operator choice, never an automatic fallback |
| `GUEST_DAILY_LIMIT`, `USER_DAILY_LIMIT`, `IP_DAILY_LIMIT` | `2`, `5`, `10` |
| `GLOBAL_DAILY_LIMIT`, `GLOBAL_MONTHLY_LIMIT`, `GLOBAL_MINUTE_LIMIT` | `25`, `800`, `4` |
| `MAX_INFLIGHT_REQUESTS`, `REQUEST_TIMEOUT_MS` | `8`, `60000` |
| `PORT` | Let Render supply it (normally 10000); the process binds `0.0.0.0:$PORT` |

No `DIRECT_URL`, `DATABASE_URL`, frontend `BUN_PUBLIC_*`, secret-generation rule or migration command is needed. Existing manually created tables and all three applied SQL migrations remain unchanged. Supabase holds durable quotas/leases/history; signed passes survive process restarts through the same signing secret. Local capacity/IP/verification throttles and model/readiness caches reset on restart; they supplement durable quotas and are not shared security ledgers. Free has one instance; don't scale this design with memory-only verification protection.

Render assigns the real HTTPS URL only after creation. Copy **that actual URL** from the service page; do not infer it from the name. The intended frontend isn't deployed or changed remotely in this milestone. Later set its existing `BUN_PUBLIC_BACKEND_URL` to that URL and finish Supabase OAuth redirects and production Turnstile hostname pairing. No backend custom domain or DNS change is needed.

## Health, readiness, proxy and shutdown

`GET /health` is only `{status:"ok"}` and runs before IP extraction, throttles and JSON body parsing, after security/CORS headers. It cannot touch the database, providers, quota or conversations. Render checks this cheap path so an external database outage doesn't cause dependency-driven restart loops. A Live dashboard status proves process health, not search readiness. `/ready` must pass separately before beta traffic.

`GET /ready` validates required settings and shares one in-flight check of four zero-row reads: usage, leases, selected-model column and answer metadata columns. Total deadline 2.5 seconds, successful result cached 30 seconds, failure 5 seconds; sibling reads are aborted on completion/failure/deadline. It never calls Auth, Turnstile, Groq or Tavily, writes rows or exercises quota RPCs. Missing settings return `NOT_CONFIGURED`; dependency failure returns `READINESS_UNAVAILABLE` and Retry-After 5. Searches also require this check and still reserve the existing atomic durable quota before retrieval/generation. Missing quota functions/storage fail closed at reservation. Readiness is a bounded storage/config check, not an external-provider availability guarantee.

The Render mode keeps Express forwarding-hop trust disabled. It reads only one syntactically valid `CF-Connecting-IP`, supplied through the managed Render/Cloudflare public ingress, for **all** throttles, pass binding, Siteverify remote IP and quota hashing. Missing, multiple or malformed values fail closed (`CLIENT_IP_UNAVAILABLE`); no XFF/True-Client-IP/Forwarded fallback exists. Local socket mode ignores supplied headers. The mode cannot be enabled without Render's runtime marker or with nonzero hop trust.

This relies on the platform boundary, not a magical authenticated HTTP header. [Render describes all public inbound traffic passing through Cloudflare](https://render.com/articles/how-render-handles-ddos-attacks); [Cloudflare documents its connecting-IP and Worker/CDN behavior](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip). Use the generated hostname directly, no added Worker/custom proxy or direct/private ingress. Do not deploy this trust mode onto another host merely by setting `RENDER=true`. Historical Render XFF advice is not a fixed-hop security guarantee, so no hop count is guessed. **Real ingress header replacement and pass continuity remain acceptance checks**, especially after topology/platform changes. Shared NAT/Worker egress shares allowances; IP changes require re-verification. Whole IPv6 addresses are quota subjects, not /64 aggregates; rotating addresses/botnets remain an abuse limitation.

Node header/body-receive timeouts are 10/15 seconds; these are distinct from the 60-second answer deadline. SSE flushes headers, sends bounded deltas/comments, waits for write drain and declares success only on `done`. Disconnect cancels provider readers; release removes the lease without refunding consumed quota. Auth/database calls have their existing timeouts. SIGTERM/SIGINT stop new connections and wait for connections to drain, with a 10-second force-exit ceiling: a long stream may be interrupted on restart and its lease expires durably. No shutdown promise implies completion or credit refunds.

## Frontend coordination prepared locally

`src/lib/startup.ts` owns one shared operation, started by the first existing safe API read. Its successful response is reused; other reads wait. Only a future entry without an early read falls back to `/health`. Budget: 120 seconds total, 8 seconds/attempt, backoff 1/2/4/8 seconds capped at 8; no polling after readiness/terminal failure/unmount. Reads recognize Render HTML, malformed JSON and network failure. UI distinguishes starting, ready, configuration failure, running-but-unavailable and unreachable; it cannot diagnose platform suspension versus network failure.

The composer allows drafting during startup. Explicit Send freezes a single pending question; Cancel retains it for editing. Readiness, available model and ordinary auth/guest clearance precede one dispatch. Layout cleanup/identity replacement/sign-out cancel pending work, streams and stale verification callbacks. Turnstile exchanges wait for startup, reject proof older than four minutes, discard expired callbacks, and never exchange the same single-use proof twice. Failed exchange needs a fresh challenge. Existing passes remain two-hour IP-bound clearance, not account auth or a quota reset. The frontend stream safety timeout starts at dispatch (75 seconds), separately from startup and the backend's 60-second answer deadline.

Any search failure/uncertain acceptance restores the question and requires a new manual Send; no automatic POST retry/replay. Cancel cannot undo already accepted quota/database/provider work. There is no scheduled keep-alive, permanent polling, public fixture endpoint or production diagnostics switch.

## Free limits and user-visible behavior

[Render Free limits](https://render.com/docs/free): idle services sleep after 15 minutes; wake-up can take about a minute and platform HTML may appear. Workspace Free hours are 750/month; exhaustion suspends Free services until the next month. Filesystem changes disappear on restart. Outbound allowance exhaustion can suspend services without a payment method; exhausted pipeline minutes can stop new builds while the existing deployment runs. Unusually high service-initiated traffic can also trigger suspension. Monitor dashboard usage and email notices; keep the workspace Hobby, no paid add-ons/payment activation and no paid fallback. The service has no availability guarantee.

App overload returns 503 `SERVER_BUSY`/Retry-After; quota exhaustion returns 429 with its specific daily/monthly/minute/IP code. UI preserves the draft and offers manual recovery. Platform suspension/outage may return HTML, fail CORS or look like network failure: startup eventually reports unavailable/unreachable, not an endless spinner or a claim that every outage is a cold start. Early reads reduce user-visible waiting but public traffic can wake Render before Turnstile, auth or quotas execute. Application checks and Render's built-in edge filtering do not provide complete infrastructure/application abuse protection.

## Logs, privacy and remaining owner decisions

Application logs contain startup port/setup setting names only; no request logger, auth/pass/IP echo, research text or analytics exporter was added. [Render documents](https://render.com/docs/logging) seven-day log visibility for Hobby; automatic HTTP request logs are a Pro-and-above feature. That is not a guarantee of seven-day retention for every infrastructure/security record or every provider. Actual workspace tier/region/access, Render/Cloudflare infrastructure practices and existing Supabase/provider retention/backups/contracts remain dashboard/privacy acceptance items. Keep all logs private and don't add external log drains. Frontend local policy text now identifies the planned backend host and these limits without claiming completed live verification.

Confirmed developer/contact/audience decisions are incorporated. Still pending for the later public frontend policy: final operator/legal identity (developer name alone doesn't establish it), eligibility/children handling for an open audience, jurisdiction/lawful-basis/transfer review, actual retention and manual access/deletion workflow, effective date and finished policy approval. Email is confirmed, not an automated rights-ticket system. These do not require deploying the frontend to prepare a backend; the existing frontend publication gate remains in place.

## HTTPS acceptance and rollback

After Render finishes deploying the reviewed commit, run `npm run smoke:deployed -- https://ACTUAL.onrender.com` from this repository. It bounds startup polling and checks HTTPS health/readiness, exact frontend CORS/preflight and rejected origins, private caching, dummy-route denial, invalid asks rejected before any quota/provider work, and replacement of a malformed supplied CF header. It never authenticates a user, exchanges Turnstile, creates history, reserves quota or searches/generates. No public IP/header diagnostic is exposed.

Then verify a real IP-bound pass privately (successful check, spoof valid CF/XFF/True-Client-IP doesn't change its identity, IP change fails, restart retains it). The malformed-header check alone is not proof of full ingress identity. Local compiled HTTP/browser fixtures exercise streaming, cancellation, deadlines and single reservation without credits. A successful **real-host** stream/cancellation needs either an approved safe fixture through the actual production path or separate permission for bounded live provider calls. No test route is exposed and no such live calls are authorized/run by this release. Do not report local fixtures as real-host verification.

Keep Auto-Deploy off. On regression choose the previous **known-safe** deploy in Render's Events/Deploys rollback controls (Free retains two prior deploys), preserving environment and SQL. First deployment has no prior safe release: suspend it while preparing a fix rather than selecting an old commit with an exposed dummy handler. Suspension also bounds further traffic while debugging; it doesn't erase Supabase data. Never reset SQL, rotate the signing secret or reapply migrations as a rollback. Resume only after `/health`, `/ready`, CORS and dummy denial pass. Keep the frontend undeployed and pause at the backend milestone.

## Evidence and remaining external work

Environment: Linux, Node v22.23.2, npm 12.0.2; optional Bun typecheck dispatch retained. Socket/browser tests use local fixtures, not real provider credentials. Fresh 2026-10-20 results:

| Check | Actual result |
| --- | --- |
| Backend `npm run check` | Pass: typecheck, 91 tests / 14 files, compiled build |
| Backend `npm run test:startup` | Pass: compiled production startup/PORT, minimal health, fail-closed readiness, CORS, dummy denial, graceful stop |
| Backend `npm run test:browser` | Pass: compiled HTTP/SSE + production React; sources, split metadata, follow-up, browser Stop abort reaches fake provider and releases one lease per reservation |
| Isolated `npm ci --omit=dev --ignore-scripts` + startup | Pass: 71 installed production packages, no dev runtime dependency; no environment files copied |
| `npm run schema:check` | Four existing Supabase table/column zero-row reads return 200; no data/migration/quota changes |
| Frontend `npm run check` | Pass: typecheck, 40 tests / 11 files, production build; existing large-chunk warning remains |
| Frontend `npm run test:browser` | Pass: model/research/account/two-tab/CSP/server regressions plus the new startup suite |
| Startup suite | Three real browser entry paths reuse existing reads, no extra health request, one shared readiness operation; HTML/slow startup, token expiry/one exchange, repeated Send, cancellation/draft retention, navigation/sign-out/account replacement, incomplete stream never replayed, configuration failure, failed readiness and unreachable timeout |
| Optional `bun run typecheck` | Pass in both repositories; no Bun runtime/lockfile change |
| `npm run release:check` (frontend) | Expected publication hold for remaining operator/policy/effective-date approval; confirmed developer/contact are populated |
| Source/artifact integrity | `git diff --check` passes; configured private values absent from planned/tracked files and both build outputs; SQL/lockfiles/Node pins unchanged; entire dummy block byte-identical to pre-work HEAD |
| Template/tool syntax | YAML parsed: Free / one instance / manual deploy / no migration hook or disk; deployment smoke script syntax checked |

Local capacity/deadline/readiness tests use fakes. These results are not a host throughput benchmark or live provider verification. Frontend fixture helpers now wait for coordinated history reads and for pending/accepted submission before checking completion.

At preparation, no Render dashboard/API credential or connected integration is available. A Render integration was discovered but is not installed/connected; dashboard setup is the fallback above. No service was created and no generated backend hostname exists. No real-host health/readiness, CORS, proxy identity or streaming/cancellation acceptance is claimed. No frontend push/deployment, DNS change, provider-plan change, signing-secret rotation or SQL mutation occurred.

Use the release commit ID in the handoff (or `git rev-parse HEAD` on `release/render-free`) and verify it in Render before deployment. GitHub push state is recorded separately at handoff; this source file cannot itself attest that a deployment occurred. Pause after backend setup/acceptance; the frontend remains for a later release.
