import { AppError } from "./lib/errors";
import type { Config } from "./lib/config";

// Supabase's Data API avoids the direct Postgres/IPv6 connection wahala sha.
// Every call is server-side; the secret key never enters the frontend bundle.
export type SupabaseFetch = (url: string, options: RequestInit) => Promise<Response>;
export function createSupabaseClient(config: Config, http: SupabaseFetch = fetch) {
  return async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!config.supabaseUrl || !config.secret)
      throw new AppError(503, "DATABASE_UNAVAILABLE", "Database setup is incomplete.");
    const response = await http(`${config.supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: config.secret,
        ...(config.secret.startsWith("sb_secret_")
          ? {}
          : { Authorization: `Bearer ${config.secret}` }),
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: options.signal || AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new AppError(
        503,
        "DATABASE_UNAVAILABLE",
        "Database request failed. Check the migration and server configuration.",
      );
    if (response.status === 204 || response.headers.get("content-length") === "0")
      return undefined as T;
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  };
}
