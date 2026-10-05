import { readConfig } from "../lib/config";

// Schema metadata only; never fetch conversation/user rows or print credentials.
const config = readConfig();
if (!config.supabaseUrl || !config.secret) {
  console.log("Data API schema inspection unavailable: configure Supabase server settings.");
  process.exit(0);
}
try {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: config.secret,
      Accept: "application/openapi+json",
      ...(config.secret.startsWith("sb_secret_")
        ? {}
        : { Authorization: `Bearer ${config.secret}` }),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) console.log("Data API metadata status:", response.status);
  else {
    const schema = (await response.json()) as {
      paths?: Record<string, unknown>;
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
    };
    console.log(
      JSON.stringify(
        {
          paths: Object.keys(schema.paths || {}),
          tables: Object.fromEntries(
            Object.entries(schema.definitions || {}).map(([name, table]) => [
              name,
              Object.keys(table.properties || {}),
            ]),
          ),
        },
        null,
        2,
      ),
    );
  }
} catch {
  console.log("Data API metadata inspection unavailable: connection failed.");
}
