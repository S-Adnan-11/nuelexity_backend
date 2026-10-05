# Legacy schema

`schema.prisma` is preserved as a record of the original data model. It is not used by the runtime, and its enums/columns are not assumed to match the manually created Supabase tables.

Do not run `prisma db push` or destructive resets. The active schema is versioned in `supabase/migrations`. See `docs/DATABASE.md` for safe adoption and optional legacy import planning.
