import { z } from "zod";

const integer = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
export function readConfig(env: Record<string, string | undefined> = process.env) {
  const config = z
    .object({
      port: integer(3002, 65535),
      guestDaily: integer(2, 10),
      userDaily: integer(5, 50),
      ipDaily: integer(10, 100),
      globalDaily: integer(25, 1000),
      globalMonthly: integer(800, 1000),
      globalMinute: integer(4, 30),
      requestTimeoutMs: integer(60000, 60000),
      aiProvider: z.enum(["none", "groq"]).default("none"),
      trustProxyHops: z.coerce.number().int().min(0).max(3).default(0),
    })
    .parse({
      port: env.PORT,
      guestDaily: env.GUEST_DAILY_LIMIT,
      userDaily: env.USER_DAILY_LIMIT,
      ipDaily: env.IP_DAILY_LIMIT,
      globalDaily: env.GLOBAL_DAILY_LIMIT,
      globalMonthly: env.GLOBAL_MONTHLY_LIMIT,
      globalMinute: env.GLOBAL_MINUTE_LIMIT,
      requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
      aiProvider: env.AI_PROVIDER,
      trustProxyHops: env.TRUST_PROXY_HOPS,
    });
  const origins = (env.FRONTEND_ORIGINS || "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((s) => new URL(s.trim()).origin);
  const supabaseUrl = (
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.VITE_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  if (supabaseUrl && new URL(supabaseUrl).protocol !== "https:")
    throw new Error("SUPABASE_URL must use HTTPS");
  const secret = env.SUPABASE_SECRET_KEY || env.VITE_SUPABASE_SECRET_KEY || "";
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const guestSecret = env.GUEST_ID_SECRET || "";
  const production = env.NODE_ENV === "production";
  const turnstileSecret = env.TURNSTILE_SECRET_KEY || "";
  const groqKey = env.GROQ_API_KEY || "";
  const tavilyKey = env.TAVILY_API_KEY || "";
  return {
    ...config,
    origins,
    supabaseUrl,
    secret,
    publicKey,
    guestSecret,
    production,
    turnstileSecret,
    groqKey,
    tavilyKey,
    groqModel: env.GROQ_MODEL || "llama-3.3-70b-versatile",
    configured: Boolean(
      supabaseUrl &&
        secret &&
        publicKey &&
        guestSecret.length >= 32 &&
        tavilyKey &&
        (config.aiProvider !== "groq" || groqKey),
    ),
    guestsEnabled: !production || Boolean(turnstileSecret),
  };
}
export type Config = ReturnType<typeof readConfig>;
