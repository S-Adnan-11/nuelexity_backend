# Configure a development environment

Use a development Supabase project. The [database guide](DATABASE.md) lists the migrations in order. Installing dependencies does not create a project or apply SQL.

## Backend

Run `npm run env:init` and fill `.env` using [.env.example](../.env.example). The local API defaults to port 3002.

| Setting | Value or purpose |
| --- | --- |
| `SUPABASE_URL` | Development project HTTPS URL |
| `SUPABASE_PUBLISHABLE_KEY` | Project's public auth key |
| `SUPABASE_SECRET_KEY` | Server-only project key for storage and quota operations |
| `TAVILY_API_KEY` | Retrieval key |
| `GUEST_ID_SECRET` | Stable random signing secret, at least 32 characters |
| `AI_PROVIDER` | `none` for retrieved excerpts, or `groq` for model synthesis |
| `GROQ_API_KEY` | Server-only model key when using Groq |
| `GROQ_MODEL` | Optional default model; see [the catalogue](MODEL_SELECTION.md) |
| `FRONTEND_ORIGINS` | Comma-separated exact frontend origins |
| `TURNSTILE_SECRET_KEY` | Server-side counterpart to the frontend site key, required in production |

Generate the guest signing secret locally, store it in server configuration, and keep it stable across restarts. Only use `CLIENT_IP_MODE=render` for the managed Render ingress described in the [deployment guide](RENDER_DEPLOYMENT.md). Local settings use `CLIENT_IP_MODE=socket` and `TRUST_PROXY_HOPS=0`.

Run `npm run config:check` before starting the API. Missing settings are reported by name. The optional `-- --remote` check contacts configured services for credential, schema and usage metadata. It does not prove that browser OAuth or Turnstile works.

## Frontend and auth

Use the same Supabase project in the [frontend](https://github.com/S-Adnan-11/nuelexity_frontend#run-locally). For OAuth, configure Google and GitHub in Supabase, and allow `http://localhost:3000/auth/callback` plus the exact deployed frontend callback if applicable. The provider application's callback points to Supabase's `/auth/v1/callback`. Keep OAuth client secrets in the Supabase provider settings, never in the browser build.

For production guest access, pair the public Turnstile site key with its server secret and configure the widget for the frontend hostname. The API checks the submitted token before issuing a guest pass. A successful sign-in is not required for guest research; it is required to save history.

## Troubleshooting

- If `/health` succeeds but `/ready` returns 503, check the backend environment and the required Supabase schema first.
- If the browser cannot call the API, check `BUN_PUBLIC_BACKEND_URL` and the exact allowed frontend origin. Origins do not include paths.
- If OAuth returns to the wrong host, check the frontend callback allowlist and Supabase Site URL. Restart the corresponding local server after configuration changes.
- Sources-only mode still makes retrieval calls. For checks that use neither search nor model credits, use `npm run check` or the documented browser fixtures.
