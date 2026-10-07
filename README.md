# Nuelexity backend

A Bun/Express research API with Tavily retrieval, optional Groq answer streaming, Supabase OAuth verification, private conversation history, and durable free-tier quota enforcement.

## Run locally

```bash
bun install --frozen-lockfile
# Copy .env.example to .env only if you do not already have .env.
bun run dev
```

The API listens on port 3002. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `TAVILY_API_KEY`, and a stable `GUEST_ID_SECRET` of at least 32 characters. The existing server `NEXT_PUBLIC_SUPABASE_*` and `VITE_SUPABASE_*` names are accepted for compatibility; use the canonical names for new environments.

`AI_PROVIDER=none` returns real retrieved excerpts and spends no model credits. To synthesize streamed cited answers, set `AI_PROVIDER=groq` and `GROQ_API_KEY` from a Groq **Free** account. The default model is `openai/gpt-oss-20b`, verified in the configured account's active-model listing on 2026-10-07 and listed in [Groq's free-plan limits](https://console.groq.com/docs/rate-limits). GPT-OSS uses low reasoning effort and excludes reasoning from streamed responses. No paid gateway or automatic provider retries are used.

Apply the additive [foundation migration](supabase/migrations/202610050001_research_foundation.sql) once in Supabase SQL Editor, then the [legacy hardening migration](supabase/migrations/202610060001_secure_legacy_tables.sql). Existing rows and enums are preserved; hardening blocks direct browser access to the old tables while the current app uses `nuelexity_` tables. See [database adoption](docs/DATABASE.md). Direct Postgres URLs and Prisma are not required for the runtime.

```bash
bun run check        # TypeScript, HTTP/provider tests, embedded Postgres/RLS tests
bun run config:check # Missing setting names only; never prints keys
bun run config:check --remote # Credential/schema/usage metadata; no search/model credits
bun run db:inspect   # Read-only metadata via a direct connection, if available
bun scripts/inspect-api.ts  # Read-only metadata through HTTPS
```

`GET /health` is liveness; `GET /ready` verifies configuration and quota storage. All tests run without real credentials or provider calls. HTTP integration tests need localhost socket access.

If search reports incomplete setup, run `bun run config:check` and check the startup warning. Groq uses `GROQ_API_KEY` (Q), not `GROK_API_KEY` (K). Restart the backend after environment changes; restart the frontend after changing its public settings. Remote checks cannot prove OAuth redirect allowlists, a successful browser challenge, or the Groq billing plan. Tavily can return an unspecified pay-as-you-go limit; check Billing rather than treating this as proof of either enabled or disabled billing.

OAuth accounts live in `auth.users`. New conversations reference that Auth ID directly, so signing in does not insert a duplicate row into legacy `public.users`. Saved research appears in `nuelexity_conversations` and `nuelexity_messages`. See [user identity and legacy profiles](docs/DATABASE.md#user-identity-and-legacy-profiles).

Guest visitors complete Turnstile once and exchange it for an IP-bound server-signed pass. The frontend reuses it across refreshes in the same tab for at most two hours. Every search still passes durable quotas; a new guest ID cannot reset the IP-based allowance. See [guest session contract](docs/API.md#guest-verification-session). No dashboard change or database migration is required for this flow.

Other available models in the configured account: `openai/gpt-oss-120b` and `qwen/qwen3.8-27b`, also listed in [Groq's free-plan limits](https://console.groq.com/docs/rate-limits). Select explicitly with `GROQ_MODEL` and restart the backend. GPT-OSS uses low reasoning effort; Qwen disables reasoning and is currently a preview model. Both keep the same 1024-token output limit and one provider request, with no tools, automatic retries, or fallback. Keep `openai/gpt-oss-20b` as the default for now.

## External configuration still required

1. Run both migrations in order in the correct Supabase project. Verify legacy table RLS with the read-only audit in `docs/DATABASE.md`. Do not rerun the historical destructive migration 2.
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
