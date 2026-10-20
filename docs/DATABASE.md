# Database adoption and migrations

The runtime uses Supabase's HTTPS Data API. A direct Postgres URL and Prisma are not needed to run Nuelexity. `schema.prisma` is retained as legacy documentation.

## Model-selection migration — 2026-10-14

The updated chat flow requires `supabase/migrations/202610140001_model_selection.sql`. It adds a nullable next-model choice to conversations and nullable actual-model metadata/generation kind to messages. Historical answers remain unknown; rows, quotas, legacy tables and RLS are preserved. The migration passed embedded PostgreSQL tests. On 2026-10-15, the existing read-only schema checker returned HTTP 200 for the selection/attribution columns and quota table, superseding the earlier missing-column result. No SQL was run and no conversation rows were read in this verification. `/ready` continues to fail closed if required storage or columns are unavailable.

Do not rerun the migration on the configured project based on the old missing-column note. The read-only `supabase/verification/202610140001_model_selection.sql` audits constraints and policies without changing data. For a genuinely new project, apply the migration once after the foundation; [model-selection adoption](MODEL_SELECTION.md#adoption-status-and-new-project-setup) records the expected checks. No reset, backfill or Prisma push is required.

## What was verified

Read-only Data API metadata confirmed the existing manual tables:

- `users`: `id`, `email`, `provider`, `name`.
- `conversations`: `id`, `title`, `slug`, `user_id`.
- `messages`: `id`, `content`, `role`, `conversation_id`, `created_at`.

The old Prisma schema has different casing and extra fields. On 2026-10-06 the owner supplied the previous SQL: migration 2 replaces migration 1's tables and defines `public.users.id` as a foreign key to `auth.users.id`. Conversations reference `public.users`, and messages use the uppercase `message_role` enum. The new foundation has been tested alongside this exact final schema with sample existing rows.

Neither supplied script enables RLS. Dashboard changes made separately are still unknown. No live data was read or changed during compatibility testing.

On 2026-10-07, read-only verification against the configured project confirmed all four foundation tables and both quota RPCs are exposed to the server key, quota storage responds successfully, and the public key cannot read the legacy tables or quota/lease tables. Google and GitHub are enabled. These checks fetch schema metadata or zero rows; they do not mutate live data or validate every remote RLS policy.

## User identity and legacy profiles

Supabase's **Authentication > Users** view manages database rows in `auth.users`. **Database > public.users** is a separate legacy application table. An OAuth signup therefore already has a database account, even when no public profile row appears.

The current backend validates the session with Supabase Auth and uses the returned Auth ID as the owner. `nuelexity_conversations.user_id` references `auth.users.id` directly; new messages belong to an owned conversation. The frontend reads the account's display name/email from its Supabase session. None of this requires a `public.users` row.

The old middleware tried `prisma.user.create()` on every authenticated request. That code had no initialized Prisma client, used a schema that differed from the manually installed tables, and tried repeated inserts rather than synchronizing updates. It was removed during the foundation work. The supplied historical SQL contains a foreign key and deletion cascade, which enforce relationships but do not insert profiles automatically. There is no active bidirectional synchronization in the current app.

Keep Auth as the identity source. If app-specific profile fields become necessary, introduce an additive profile table with a reviewed one-way Auth provisioning trigger, backfill existing accounts, and apply owner policies. Do not recreate the legacy per-request insert or synchronize credentials in both directions. Supabase documents [public profiles and Auth triggers](https://supabase.com/docs/guides/auth/managing-user-data), including the risk that a failing signup trigger blocks account creation.

## Apply the additive foundation

1. Open the correct Supabase project's **SQL Editor**. Review `supabase/migrations/202610050001_research_foundation.sql`.
2. Run the complete file once. It uses a transaction and creates only `nuelexity_` tables/functions/policies. Existing manual tables are untouched. Do not rerun it after successful execution.
3. Run `supabase/migrations/202610060001_secure_legacy_tables.sql`. It enables RLS and revokes direct browser access to `users`, `conversations`, `messages`, and the old message identity sequence. Existing data, Auth accounts, enums, relationships, and existing server grants are preserved. The current frontend/backend use the new tables, so they do not need browser access to the old ones. An older client that directly uses those legacy tables will lose access.
4. Set the backend URL, publishable key, server secret key, Tavily key, and stable guest identity secret. `GET /ready` should return 200 after the migration is visible through the Data API.
5. Test an owned conversation and confirm another account cannot read it. Do not rerun the historical migration 2: its `DROP TABLE ... CASCADE` statements delete old history.

The migrations were executed against embedded PostgreSQL with test Supabase roles, `auth.users`, and `auth.uid()` stubs. Tests cover compatibility with the owner's migration 2, preservation of existing rows/enums, legacy browser restrictions, quotas, leases, UTC periods, RLS, ownership constraints, and cascading deletion. This does not replace verification against your remote Supabase configuration.

## Future versioned workflow

With the Supabase CLI installed and direct/pooler connectivity available:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
# Baseline the existing manual database BEFORE future managed pushes.
supabase db pull
supabase migration list
```

If the foundation was run in the SQL Editor, reconcile its history with `supabase migration repair 202610050001 --status applied` only after confirming every object exists. Likewise, mark `202610060001` applied only after confirming the legacy hardening was executed. Do not mark an unapplied migration as applied. Review the ordering of a pulled baseline and these migrations; a schema pull after applying them already includes their effects and must not be replayed together with a duplicate foundation. See [Supabase migration guidance](https://supabase.com/docs/guides/deployment/database-migrations).

For a fresh project, the committed migration can be applied normally. For the existing project, establish a reviewed baseline first; never use `supabase db reset --linked`, `prisma migrate reset`, or `prisma db push` as a shortcut.

## Legacy tables and import

The new app stores history in `nuelexity_conversations` and `nuelexity_messages`. Old rows are retained but are not shown automatically. The supplied migration 2 establishes that old `users.id` values reference Supabase Auth IDs, so the ownership mapping is defined. A future import still needs a backup/export, row validation, and explicit conversion from uppercase enum roles and bigint message IDs to the new format.

The foundation alone leaves legacy grants unchanged; the separate hardening migration closes direct browser access. Run this read-only audit in SQL Editor to verify the remote state:

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public';
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
```

The app's current clients use only `nuelexity_` history tables. Legacy tables are retained for a controlled future import, without direct browser access. If another application still uses the old tables, coordinate its move before applying the hardening migration. See [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) for how privileges and policies combine.

## Budget/storage maintenance

The owner confirmed that the legacy app had no users or conversations before the foundation was adopted. Optional removal is prepared in `supabase/maintenance/202610070001_remove_empty_legacy_tables.sql`; this is manual maintenance, not an automatically applied migration. It takes exclusive locks, refuses any legacy rows, stops for custom Auth triggers that need review, and drops only `public.messages`, `public.conversations`, `public.users`, and their two legacy enum types. It uses no `CASCADE`; unexpected dependencies abort the transaction. Auth users, new research/history tables, and quota storage remain intact. Run it only if you choose to retire those empty legacy objects; no cleanup is needed for the app to work. It has not been run against the remote database.

Quota counters are durable and shared by backend instances. Subject/IP identifiers are HMAC hashes, not raw IPs. Keep `GUEST_ID_SECRET` stable. Calendar-day/month budgets reset in UTC. Obsolete minute/day/month counters and leases are cleaned during reservations. No quotas are refunded automatically.

If deleting a user's account, delete it through Supabase Auth; new conversations/messages cascade. Retention is currently user-controlled through thread deletion. Public deployment should define a retention policy and add an account deletion flow before handling a broader audience.
