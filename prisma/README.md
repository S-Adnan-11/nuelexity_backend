# Legacy schema

`schema.prisma` is preserved as a record of the original data model. It is not used by the runtime, and its enums/columns are not assumed to match the manually created Supabase tables.

Do not run `prisma db push` or destructive resets. The active schema is versioned in `supabase/migrations`. See `docs/DATABASE.md` for safe adoption and optional legacy import planning.

The legacy generator’s `runtime = "bun"` is historical metadata only. No Prisma generator/client is installed or executed by npm install, build, tests, or server startup. Do not use that generator to set up this application.
