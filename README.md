# Nuelexity · Backend

The API behind Nuelexity, a search-first research workspace. It retrieves web sources, streams cited answers and saves signed-in conversations. It also validates guest access and enforces shared search limits.

**[Open Nuelexity](https://nuelexity.devs.surf/) · [Frontend repository](https://github.com/S-Adnan-11/nuelexity_frontend) · [API contract](docs/API.md)**

[![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=black)](https://supabase.com/)

## Run locally

Use Node.js **22.23.2 or later in the 22.x line** and npm **10.9–12**. CI uses the pinned Node version from `.nvmrc` and npm 12.0.2. Bun is not needed.

```sh
git clone https://github.com/S-Adnan-11/nuelexity_backend.git
cd nuelexity_backend
npm ci
npm run env:init
```

The initializer creates `.env` only if it does not exist. Follow [service setup](docs/SETUP.md) for a development Supabase project and provider configuration. Then run:

```sh
npm run config:check
npm run dev
```

Open **http://localhost:3002/health** for process status and **http://localhost:3002/ready** for configuration and storage readiness. A running process can return 503 from readiness if setup is incomplete. Stop with Ctrl+C. Run the [frontend](https://github.com/S-Adnan-11/nuelexity_frontend#run-locally) in a second terminal with `BUN_PUBLIC_BACKEND_URL=http://localhost:3002`.

## How it works

The server validates the request, checks the caller's identity or guest pass, and reserves capacity in Supabase before retrieving sources or generating an answer. Model availability checks can run before the reservation. It sends sources and answer deltas as server-sent events. Signed-in history belongs to the verified Supabase user; guest history stays in the browser.

| Component | Role |
| --- | --- |
| Node.js, Express, Zod | HTTP entry point, request validation and streaming |
| Supabase Auth and PostgreSQL | Identity, private conversations and atomic quota reservations |
| Tavily | Web retrieval |
| Groq | Optional answer synthesis; model calls use its HTTP API |
| Cloudflare Turnstile | Server-verified guest challenge |
| `index.ts`, `app.ts` | Server startup and API routes |
| `lib/store.ts`, `lib/providers.ts` | Data API and provider adapters |
| `lib/readiness.ts`, `lib/guest-session.ts` | Readiness checks and IP-bound guest passes |
| `supabase/migrations/` | Active database schema; Prisma is a historical reference |

Set `AI_PROVIDER=none` for sources-only responses. That mode still uses Tavily. Set `AI_PROVIDER=groq` and supply a Groq key for synthesized answers. The API defines the [model catalogue and persistence behavior](docs/MODEL_SELECTION.md). Requests have bounded input, output and concurrency; provider failures do not automatically switch models or replay searches.

## Develop and verify

```sh
npm run check
npm run test:startup
```

`check` runs TypeScript, offline tests and the build. `test:startup` exercises the compiled server without live provider credentials. The test suite uses fake services and embedded PostgreSQL for migration checks. Use a development project for configured integration checks.

To test the browser against the compiled API, build the frontend in a sibling checkout and run from this backend checkout:

```sh
npm run test:browser -- ../nuelexity_frontend/dist
```

The browser harness uses fake services. It needs Chrome or Chromium; point `CHROME_BIN` to the executable if needed. Pass the actual frontend build path for a different directory layout.

The [API contract](docs/API.md) is the source of truth for requests and SSE events. If you change it, verify the matching frontend in the same pass. For schema setup and history storage, see the [database guide](docs/DATABASE.md). For production build and operational checks, see [Render deployment](docs/RENDER_DEPLOYMENT.md).
