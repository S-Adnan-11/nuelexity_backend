import { expect, test } from "bun:test";
import { readConfig } from "../lib/config";

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
