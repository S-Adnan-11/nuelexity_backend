# Database and migrations

Supabase Auth owns user identities. The API verifies the bearer token and uses its Auth ID to scope reads and writes. A new conversation references `auth.users.id` directly, without a row in the legacy `public.users` table. Messages are scoped through their conversation.

The runtime uses Supabase's HTTPS Data API. Neither a direct Postgres URL nor the legacy Prisma generator is required for the running service.

## Set up a new development project

Review and apply the files in order to the correct Supabase project:

1. [Research foundation](../supabase/migrations/202610050001_research_foundation.sql): conversation/message storage, usage counters, leases and quota RPCs.
2. [Legacy table hardening](../supabase/migrations/202610060001_secure_legacy_tables.sql): removes browser access to applicable legacy tables.
3. [Model selection](../supabase/migrations/202610140001_model_selection.sql): adds conversation selection and message attribution fields.

For an existing installation, inspect migration state before applying missing changes. Do not reset or run Prisma schema push. Review any legacy objects and back up data before applying schema changes.

`npm run schema:check` uses zero-row Data API checks for required columns and quota storage. The [model selection SQL check](../supabase/verification/202610140001_model_selection.sql) inspects related schema and policies. Neither check is a substitute for exercising authorization in the intended environment. Migration tests use embedded PostgreSQL and test identities.

## History, permissions and quotas

`nuelexity_conversations` and `nuelexity_messages` hold saved threads and answers. The API scopes mutations to the verified owner; deleting a conversation cascades to its messages. Guests do not get saved conversation rows. Legacy tables are not automatically imported.

Database quotas reserve allowances and active leases atomically. The server key is required for quota operations; never expose it in the frontend. Server read access does not make a thread public. See [API errors and quotas](API.md#errors-and-quotas) for the client contract.

The script under `supabase/maintenance/` is optional manual legacy maintenance, outside normal setup and deployment. It is not needed to run the current app. Review any cleanup independently against the actual schema and backups.
