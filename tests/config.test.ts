import { expect, test } from "vitest";
import { readConfig } from "../lib/config.js";

const settings = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "server-key-test-only",
  SUPABASE_PUBLISHABLE_KEY: "public-key-test-only",
  GUEST_ID_SECRET: "x".repeat(32),
  TAVILY_API_KEY: "search-key-test-only",
};

test("a misspelled Groq key explains the shared guest and account setup failure", () => {
  const config = readConfig({ ...settings, AI_PROVIDER: "groq", GROK_API_KEY: "typo-key" });
  expect(config.configured).toBe(false);
  expect(config.missingSettings).toEqual(["GROQ_API_KEY"]);
  expect(JSON.stringify(config.missingSettings)).not.toContain("typo-key");
  expect(
    readConfig({ ...settings, AI_PROVIDER: "groq", GROQ_API_KEY: "correct-key" }).configured,
  ).toBe(true);
});

test("configuration diagnostics retain legacy aliases and fail closed without quota identity", () => {
  const config = readConfig({
    NEXT_PUBLIC_SUPABASE_URL: settings.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: settings.SUPABASE_PUBLISHABLE_KEY,
    VITE_SUPABASE_SECRET_KEY: settings.SUPABASE_SECRET_KEY,
    TAVILY_API_KEY: settings.TAVILY_API_KEY,
  });
  expect(config.configured).toBe(false);
  expect(config.missingSettings).toEqual(["GUEST_ID_SECRET (at least 32 characters)"]);
  expect(readConfig(settings).missingSettings).toEqual([]);
});

test("public production requires exact origins, real guest protection and explicit Render IP mode", () => {
  const env = { ...settings, NODE_ENV: "production", RENDER: "true" };
  expect(readConfig(env).missingSettings).toEqual(["FRONTEND_ORIGINS", "TURNSTILE_SECRET_KEY", "CLIENT_IP_MODE=render"]);
  expect(readConfig({ ...env, FRONTEND_ORIGINS: "https://nuelexity.devs.surf", CLIENT_IP_MODE: "render", TURNSTILE_SECRET_KEY: "real-key-fixture" }).configured).toBe(true);
  expect(readConfig({ ...env, TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" }).configured).toBe(false);
  for (const origin of ["http://public.test", "https://public.test/private", "https://user:secret@public.test"])
    expect(() => readConfig({ ...env, FRONTEND_ORIGINS: origin })).toThrow("FRONTEND_ORIGINS");
});
