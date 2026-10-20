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
      maxInflight: integer(8, 32),
      aiProvider: z.enum(["none", "groq"]).default("none"),
      trustProxyHops: z.coerce.number().int().min(0).max(3).default(0),
      clientIpMode: z.enum(["socket", "render"]).default("socket"),
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
      maxInflight: env.MAX_INFLIGHT_REQUESTS,
      aiProvider: env.AI_PROVIDER,
      trustProxyHops: env.TRUST_PROXY_HOPS,
      clientIpMode: env.CLIENT_IP_MODE,
    });
  const origins = (env.FRONTEND_ORIGINS || "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((s) => {
      const url = new URL(s.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash)
        throw new Error("FRONTEND_ORIGINS must contain exact HTTP(S) origins");
      if (env.NODE_ENV === "production" && url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        throw new Error("Production FRONTEND_ORIGINS must use HTTPS");
      return url.origin;
    });
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
  if (config.clientIpMode === "render" && (env.RENDER !== "true" || config.trustProxyHops !== 0))
    throw new Error("CLIENT_IP_MODE=render requires Render managed ingress and TRUST_PROXY_HOPS=0");
  const turnstileSecret = env.TURNSTILE_SECRET_KEY || "";
  const groqKey = env.GROQ_API_KEY || "";
  const tavilyKey = env.TAVILY_API_KEY || "";
  // List setting names only. No key values in diagnostics sha.
  const missingSettings = [
    !supabaseUrl && "SUPABASE_URL",
    !secret && "SUPABASE_SECRET_KEY",
    !publicKey && "SUPABASE_PUBLISHABLE_KEY",
    guestSecret.length < 32 && "GUEST_ID_SECRET (at least 32 characters)",
    !tavilyKey && "TAVILY_API_KEY",
    config.aiProvider === "groq" && !groqKey && "GROQ_API_KEY",
    production && !env.FRONTEND_ORIGINS && "FRONTEND_ORIGINS",
    production && !turnstileSecret && "TURNSTILE_SECRET_KEY",
    production && /^[123]x0{20,}/.test(turnstileSecret) && "TURNSTILE_SECRET_KEY (production key required)",
    production && env.RENDER === "true" && config.clientIpMode !== "render" && "CLIENT_IP_MODE=render",
  ].filter((name): name is string => Boolean(name));
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
    groqModel: env.GROQ_MODEL || "openai/gpt-oss-20b",
    missingSettings,
    configured: missingSettings.length === 0,
    guestsEnabled: !production || Boolean(turnstileSecret),
  };
}
export type Config = ReturnType<typeof readConfig>;
