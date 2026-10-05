# Nuelexity backend

A Bun/Express research API with Tavily retrieval, optional Groq answer streaming, Supabase OAuth verification, private conversation history, and durable free-tier quota enforcement.

## Run locally

```bash
bun install --frozen-lockfile
# Copy .env.example to .env only if you do not already have .env.
bun run dev
```

The API listens on port 3002. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `TAVILY_API_KEY`, and a stable `GUEST_ID_SECRET` of at least 32 characters. The existing server `NEXT_PUBLIC_SUPABASE_*` and `VITE_SUPABASE_*` names are accepted for compatibility; use the canonical names for new environments.

`AI_PROVIDER=none` returns real retrieved excerpts and spends no model credits. To synthesize streamed cited answers, set `AI_PROVIDER=groq` and `GROQ_API_KEY` from a Groq **Free** account. The default model is `llama-3.3-70b-versatile`; confirm availability and limits in your account. No paid gateway or automatic provider retries are used.

Apply the additive [SQL migration](supabase/migrations/202610050001_research_foundation.sql) once in Supabase SQL Editor. Existing manual tables are not overwritten. See [database adoption](docs/DATABASE.md). Direct Postgres URLs and Prisma are not required for the runtime.

```bash
bun run check        # TypeScript, HTTP/provider tests, embedded Postgres/RLS tests
bun run db:inspect   # Read-only metadata via a direct connection, if available
bun scripts/inspect-api.ts  # Read-only metadata through HTTPS
```

`GET /health` is liveness; `GET /ready` verifies configuration and quota storage. All tests run without real credentials or provider calls. HTTP integration tests need localhost socket access.

## External configuration still required

1. Run the migration in the correct Supabase project. Check legacy table RLS with the read-only audit in `docs/DATABASE.md`.
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
- [API contract](docs/API.md), [review/plan](docs/PROJECT_REVIEW.md), and [working agreement](AGENTS.md).

`maadan-dev` owns frontend refinement; coordinate API/event changes before updating frontend requests. Changes are local and reviewable; no teammate messages, Git pushes, or deployments are performed by these scripts.

Provider references: [Tavily credits](https://docs.tavily.com/documentation/api-credits), [Groq limits](https://console.groq.com/docs/rate-limits), [Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
