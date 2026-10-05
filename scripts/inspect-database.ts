import { Client } from "pg";

// Read schema names and policies only. No user rows or credentials enter the output.
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.log("Database inspection unavailable: no connection URL configured.");
  process.exit(0);
}
const client = new Client({ connectionString, connectionTimeoutMillis: 8000, query_timeout: 8000 });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const tables = await client.query(
    `select t.table_name, c.column_name, c.data_type from information_schema.tables t join information_schema.columns c using (table_schema, table_name) where t.table_schema = 'public' order by t.table_name, c.ordinal_position`,
  );
  const policies = await client.query(
    `select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' order by tablename, policyname`,
  );
  console.log(JSON.stringify({ tables: tables.rows, policies: policies.rows }, null, 2));
  await client.query("ROLLBACK");
} catch (error) {
  // PG error messages may contain usernames/hosts; print the class/code only.
  console.log(
    "Read-only database inspection unavailable:",
    (error as { code?: string }).code || "connection failed",
  );
} finally {
  await client.end();
}
