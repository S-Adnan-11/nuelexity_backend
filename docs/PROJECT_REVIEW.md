# Nuelexity review and delivery plan

## Current milestone — 2026-10-16

The existing Node/npm migration and chat refinements were reviewed, verified and committed locally in both repositories. The frontend now supports paginated library browsing and private `/dashboard/<conversation-id>` URLs with direct loading, browser back/forward, scroll restoration, safe sign-in return and navigation cancellation. These use the existing owned conversation API; no migration or provider configuration change is needed. See the [updated frontend handoff](../../../frontend/nuelexity_frontend/docs/HANDOFF.md).

The next work is free hosting/DNS/HTTPS setup, production OAuth/Turnstile origin verification, and physical mobile/screen-reader review. Work is paused after the local delivery at the owner's request. No changes were pushed or deployed, no live provider calls were made, and no remote database changes were performed during this delivery. The foundation review below is historical.

The historical verification below originally used Bun; runnable command examples now use the supported npm workflow. See the backend `NPM_SUPPORT.md` for the Node migration results.
The 2026-10-14 [model-selection delivery](MODEL_SELECTION.md) adds the owner-approved Groq catalogue, conversation choices, confirmed per-answer attribution and accessible selector. Code and local verification are complete; zero-row checks on 2026-10-15 confirmed access to the model-selection columns in the owner’s project. New projects still require that additive migration. The historical foundation review below describes the earlier baseline.

## Goal and current baseline

Build Nuelexity into a Perplexity-style research product: an accessible query composer, live web retrieval, streamed answers, verifiable inline citations, suggested follow-ups, and private saved conversations. Paid multi-model councils, file ingestion, agents, image generation, and subscriptions are deferred.

The workspace contains two separate Git repositories. The backend baseline is `3146b7d`. The frontend was fast-forwarded from `a5a5330` to `cd6ac87`, including `maadan-dev`'s `bb542b5` changes to root routing, shared Supabase access, and the conversation route. No teammate work was discarded.

All application source, package/build configuration, UI primitives, schema, environment templates, and supplied Perplexity notes/HAR were inspected. Secrets were inspected only for presence/name, never printed. The HAR shows POST-based SSE with source/answer blocks, conversation identifiers, completion state, and related queries. Cookies, analytics, tracking, and private Perplexity tokens are not copied into this app.

## Findings

| Priority | Finding | Decision |
| --- | --- | --- |
| Critical | Frontend `env = "inline"` can bundle unrelated secrets | Whitelist public environment settings for dev and build |
| Critical | Search has no durable quota or concurrency guard | Reserve limits atomically in Postgres before any provider call |
| High | Auth passes an entire header to Supabase, invokes undefined `prisma`, logs personal data | Verify Bearer tokens, stop per-request user creation, keep credentials out of logs |
| High | CORS middleware is not invoked | Explicit allowed origins, bounded JSON parsing, predictable error handling |
| High | SSE ends after the first token and writes after ending | Typed SSE events, completion/error distinction, cancellation and timeout |
| High | Advanced Tavily and a paid model gateway conflict with zero budget | Basic search, optional Groq free-tier adapter, sources-only fallback; no automatic retries |
| High | Prisma is uninstalled/unconfigured and disagrees with manual SQL | Supabase SQL becomes the schema source of truth; preserve legacy tables/schema |
| High | Conversation and follow-up routes are empty or misspelled | Implement owned history, details, deletion, and follow-ups on the same ask flow |
| Medium | Root auth only supports a minimal dashboard | Preserve teammate routing and add guest research and integrated search UI |
| Medium | Conflicting package locks, no tests/CI/check scripts | Originally standardized on Bun; superseded by Node/npm and canonical package-lock.json (see ../NPM_SUPPORT.md) |

## Implementation order

1. Pull both repos, inspect source and references, write working agreements and this review.
2. Replace the backend foundation: input validation, optional auth, owned history, safe SSE, aborts, provider isolation, and quota reservations.
3. Add an additive versioned SQL migration with RLS and service-only quota RPCs. Test locally without touching existing remote tables.
4. Connect a responsive research UI, safe citations, streaming, cancellation, guest mode, OAuth callback, and saved history.
5. Run checks/builds and document setup and remaining remote verification. Hand `maadan-dev` clear UI tasks and a stable API contract.

## Budget decisions

- Guest allowance: 2 requests per UTC day per IP-derived identity; signed-in allowance: 5 per user/day.
- IP ceiling: 10 requests/day across identities. Shared app ceilings: 25/day, 800/month, 4/minute. Defaults are deliberately conservative and configurable server-side.
- One active request per identity, 60-second request deadline, bounded sources/history/output, no automatic paid/provider retries.
- Failed/cancelled attempts retain their reservation because upstream credits may already be consumed.
- Sources-only mode is honest: it returns retrieved excerpts, not an invented AI answer. Optional Groq configuration enables synthesis without a paid gateway.
- Provider account controls remain necessary: keep Tavily pay-as-you-go disabled and Groq on its Free tier. App quotas cannot control other applications using the same keys.

Current provider references (checked 2026-10-05): [Tavily credit costs](https://docs.tavily.com/documentation/api-credits), [Groq free limits](https://console.groq.com/docs/rate-limits), [Groq billing](https://console.groq.com/docs/billing-faqs), [Turnstile verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations).

## Database boundary

The existing direct connection refused a read-only schema inspection. HTTPS Data API metadata confirmed lowercase `users`, `conversations`, and `messages` with columns differing from Prisma; constraints, policies, and migration history remain unverified. The new tables use a `nuelexity_` prefix and do not overwrite those manual tables. Existing history is not imported implicitly. SQL Editor execution is supported so adoption does not depend on Prisma or direct IPv6 database connectivity.

## Teammate handoff

`maadan-dev` can own responsive visual refinement, safe Markdown rendering, mobile history navigation, focus management, source presentation, and screen-reader improvements. Backend ownership, durable budgeting, API versioning, schema changes, and provider settings stay with the project lead. Both repos carry their own `AGENTS.md` and runnable checks. Work on short branches; agree on API changes before changing request/event fields. No messages or pushes to the teammate were authorized or sent.

## Verification and delivery status

- Backend: typecheck passes; 33 tests pass, covering HTTP/auth/ownership/quota failures, provider protocols, cancellation, contextual follow-ups, actual Data API request construction, and embedded PostgreSQL/RLS.
- Frontend: typecheck passes; seven parser/public-config/source-URL tests pass; production build passes. A fresh isolated dependency install/build also passes.
- Chrome smoke checks pass for desktop/mobile, guest streaming, source citations, safe text rendering, follow-up context, quota errors, interrupted streams, and the sign-in page. A fake signed-in session verifies Bearer headers, library loading, thread opening, and deletion without accessing live user data.
- Production static artifacts are separately browser-checked. Public configuration is a four-field `config.json` whitelist loaded before Supabase initialization, with matching whitelisted development and production configuration.
- The dummy handler remains byte-for-byte identical. Build artifacts were scanned for configured secrets; none were found.
- Live model/search calls, real OAuth redirects, and remote migration behavior remain unverified until the owner completes `docs/SETUP.md`. No provider credits were consumed, no existing Supabase data was mutated, and no Git pushes or deployments occurred.

This delivery establishes the core research foundation. Full product parity, rich Markdown presentation, sharing, large-scale throughput, file ingestion, and multi-model features remain future roadmap work.

## Migration compatibility update — 2026-10-06

The owner supplied historical migrations 1 and 2. Migration 2 is the final schema: `public.users.id` references `auth.users.id`, conversations reference `public.users`, and messages use the uppercase enum with bigint IDs. A local PostgreSQL regression suite recreates that schema with existing rows and verifies the foundation installs alongside it without changing rows or enum values. New research requires no legacy profile row because it links directly to Auth IDs.

The foundation file remains unchanged. A separate `202610060001_secure_legacy_tables.sql` enables RLS and revokes direct browser privileges on the old history/profile tables and message sequence. It preserves records, Auth accounts, foreign keys, enum values, and explicit server grants. The current app uses only the new tables; any other client using the old tables directly must move before applying hardening. Neither historical SQL script enabled RLS, although separate dashboard changes remain unknown.

Both migrations are ready for owner execution in SQL Editor. No live database mutations were performed during this update; step 7 remains the owner's live verification after applying them.
