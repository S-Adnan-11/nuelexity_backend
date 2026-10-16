# Node/npm migration audit

The supported runtime is Node.js 22.23.2+ within the 22 LTS line, with npm 10.9–12. Both independent repositories enforce this through `engines` and `.npmrc`; `.nvmrc` pins the tested Node version. The existing React Router 8.4.0 requires Node ≥22.22.0 and Supabase 2.117.0 requires ≥22.0.0. Application dependency versions were retained. Vite 7.3.7, Vitest 4.1.12, tsx 4.23.15 and the existing Tailwind 4.3.3 plugin are explicit build/test tools; Node 22 meets their engines.

## Audit and handling

| Original dependency on Bun | Node/npm implementation |
| --- | --- |
| Both manifests declared Bun engines/package manager; only Bun locks existed | Node/npm engines, canonical npm v3 `package-lock.json` in each repository; obsolete Bun locks removed and generated Bun locks ignored |
| Backend `bun --watch index.ts` and `bun index.ts` executed TypeScript | Node watch + explicit tsx development loader; tsc emits native ESM JavaScript, and production start uses Node without tsx |
| Backend `import.meta.main`, implicit extension resolution and Bun ambient types | Node URL-based entry detection, explicit `.js` module imports with NodeNext compilation, explicit Node types |
| Frontend `serve` from `bun`, HTML routes and `Bun.file` assets | Vite dev/HMR and a Node/Express production server serving `dist`; explicit SPA routes, proper asset MIME types and startup public config |
| `Bun.build`, `bun-plugin-tailwind`, `bunfig.toml` | Vite and matching `@tailwindcss/vite`; existing React/TypeScript/Tailwind architecture preserved |
| Tailwind Bun plugin peer required `bun` | Plugin removed; npm no longer resolves/downloads a Bun executable. Supabase's OpenTelemetry peer is declared explicitly. No force/legacy-peer-deps flags |
| Bun automatically loaded `.env` for servers, builds and diagnostics | Node `loadEnvFile` preload for scripts and explicit production loading. Local > mode > base; explicit process values win. Regression tests cover precedence and non-overwriting initialization |
| `BUN_PUBLIC_*` names and legacy `VITE_SUPABASE_*` compatibility | Names retained as data; four-field `public-env.mjs` whitelist used by dev, builds and production. Vite/test automatic env loading and browser env exposure are disabled |
| `bun:test` imports throughout both suites | Vitest on Node, preserving HTTP/provider/Postgres/stream/parser/Markdown/guest/model/follow-up regressions |
| `Bun.file` and `import.meta.dir` in SQL/brand tests | `node:fs/promises` and Node `import.meta.dirname` |
| Browser fixture `Bun.serve` / `Bun.spawn`, Linux `/tmp` paths | Node HTTP/Fetch/SSE bridge, Node child processes, OS temp paths, configurable Chrome executable; actual production server smoke is plain `.mjs` and works without dev dependencies |
| Diagnostic utilities invoked TypeScript through Bun | Named npm scripts use Node + tsx and explicit env loading: config, schema, database/API metadata and opt-in model diagnostics |
| Bun CI/actions, README/setup/handoff instructions and secret-generation example | Node setup + npm ci/check/build/browser/startup CI; npm-first documentation and Node crypto example |
| `prisma/schema.prisma` generator says `runtime = "bun"` | Historical inactive schema retained and documented. No Prisma dependency, generation, schema push or migration runs during npm workflows |

No scripts install Bun, call a paid gateway, retry providers, apply SQL or provision external services. The complete `/requestlity_nuelexity` dummy block is byte-for-byte unchanged (SHA-256 `36d9bca4d3bd3dde5a1e06a2ab56f00bcd2cb48f69557242ddcaa4f1d4549fac`). The owner's pre-existing SQL edit is also unchanged. API payloads and production search logic remain intact; `.js` import suffixes support native Node ESM output.

## Reproduce

Use the [backend README](README.md) and the frontend repository README for clone/install, environment and exact working-directory commands. In the combined layout, run `npm ci`, `npm run env:init`, fill your own settings and `npm run dev` separately in `backend/nuelexity_backend` and `frontend/nuelexity_frontend`. Backend: localhost:3002; frontend: localhost:3000. Ctrl+C stops each process; rerun its command after edits. `env:init` preserves an existing `.env`.

In each repository, `npm run check` combines type checking, offline tests and production build. `npm run test:startup` checks real Node startup and graceful shutdown, including after `npm prune --omit=dev`. For a fresh production host, build first elsewhere, copy the README's listed runtime files and run `npm ci --omit=dev`, then `npm start`. Frontend browser checks require Chrome/Chromium; the backend browser check also needs the built sibling frontend or an explicit dist path. Neither is a prerequisite for ordinary npm checks or server startup.

The only committed dependency lock is npm's lockfile. For dependency edits, use `npm install`, commit both manifest and npm lock, then verify `npm ci`. Optional Bun 1.4.0 installation imports the npm lock; generated Bun locks stay ignored and should be removed before importing a changed npm lock. Node/npm remains installed for that optional package-manager workflow.

## Local verification — 2026-10-16

Verification uses disposable copies under `/tmp/nuelexity-npm-migration`, initially with no node_modules, no developer `.env`, and no Bun on PATH. The copies include the owner's current uncommitted refinements so those behaviors are exercised too. Node and npm were linked into a restricted PATH with `/usr/bin:/bin`; `command -v bun` found nothing. Neither npm dependency graph contains Bun, bun-types or the Bun Tailwind plugin. The owner's node_modules and environment files were not replaced. Both original repositories were dirty, so no pull, reset, commit or push was performed.

- Linux x86_64, Node 22.23.2, npm 12.0.2: `npm install`, clean `npm ci`, dependency-tree validation, both complete checks and production builds passed.
- Unsupported Node 18/npm 9 was rejected by `npm ci` with `EBADENGINE`, confirming strict version enforcement.
- npm 10.9.0: clean `npm ci` and both complete checks passed with the same lockfiles.
- Backend: **78 tests / 11 files** passed, including fake-provider HTTP streaming, cancellation/deadlines, CORS, auth/ownership, shared quotas, Turnstile passes, model enforcement/attribution, context/footer parsing and embedded PostgreSQL migrations/RLS. No live database was changed.
- Frontend: **23 tests / 7 files** passed, including safe Markdown/citations, arbitrary SSE chunk parsing, public settings, guest passes, model state, invalid follow-up metadata and environment initialization.
- Both frontend Chrome fixture suites passed against production output: model keyboard/mobile controls, guest locks, history/auth races, Markdown and stream interruption/cancellation, viewport/layout regressions and assets. Production Node asset/config/SPA smoke passed.
- The additional Chrome check passed against the real compiled Node API and actual React bundle with fake services: readiness, streamed text/citations, split metadata hidden from UI, validated suggestion submission with conversation context, malformed optional metadata completing safely, browser Stop reaching the provider's abort signal and exactly one reservation per request.
- The exact documented `npm run dev` and `npm start` commands started both servers with Bun absent. HTTP checks verified environment-loaded ports, public config, SPA routes and Vite TSX compilation; the development server denied filesystem access to the environment file.
- Both production startup checks passed after `npm prune --omit=dev` and after separate clean `npm ci --omit=dev` installs containing only the documented runtime files. No tsx, tsc, Vite or test runner is required by start. Graceful SIGTERM was verified.
- All five backend utility npm commands were exercised with fake metadata HTTP, no direct database connection and no live generation. Schema check reported three ready zero-row checks from the fake; these are not claims about a real Supabase project.
- Bun 1.4.0 was tested separately: optional installation imported each npm lock, `bun run check`, `bun run dev`, `bun run start` and production startup checks passed using Node. Bun is optional and its generated locks are ignored.

Vite reports ignored third-party `use client` directives and an application chunk above 500 KB; builds succeed. These are build notices, not a framework or UI change. Hosted GitHub Actions has been updated but has not run for these local changes. Windows/macOS and physical mobile devices were not tested. Real OAuth, Turnstile hostname pairing, Supabase persistence with a developer's own account and provider availability remain external verification; no provider credits were consumed here.

## Owner actions

Review and publish the changes in **both** repositories before sending clone instructions to a friend. Include the existing untracked follow-up modules/tests and relevant documentation along with the npm migration files; they are part of the tested snapshot. Backend setup/API/database/model/review docs were previously ignored; they are now explicitly eligible for version control so clean clones receive their linked instructions. Existing owner environment values and Supabase tables need no changes for this runtime migration. New developers must supply their own service configuration and apply the additive SQL only where missing. npm install never does that work.

Tool references: [Node environment loading](https://nodejs.org/docs/latest-v22.x/api/process.html#processloadenvfilepath), [Vite](https://vite.dev/guide/), [Vitest](https://vitest.dev/guide/).
