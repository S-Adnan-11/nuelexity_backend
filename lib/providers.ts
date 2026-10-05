import { z } from "zod";
import { buildPrompt, SYSTEM_PROMPT } from "../prompts";
import type { Config } from "./config";
import { AppError } from "./errors";
import { readSse } from "./sse";
import type { Providers, Source } from "./types";

export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const resultsSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string().nullish(),
      }),
    )
    .max(20),
});

export type ProviderFetch = (url: string, options: RequestInit) => Promise<Response>;
export function createProviders(config: Config, http: ProviderFetch = fetch): Providers {
  return {
    async search(query, signal) {
      // Explicitly disable upgrades/research/extra answer calls. Basic = one credit.
      const response = await http("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.tavilyKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: 5,
          auto_parameters: false,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok)
        throw new AppError(
          503,
          "SEARCH_UNAVAILABLE",
          "Web search is temporarily unavailable. Please try again later.",
        );
      const parsed = resultsSchema.safeParse(await response.json());
      if (!parsed.success)
        throw new AppError(502, "INVALID_SEARCH", "Web search returned an invalid response.");
      const seen = new Set<string>();
      const sources: Source[] = [];
      for (const item of parsed.data.results) {
        const url = safeUrl(item.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        sources.push({
          id: sources.length + 1,
          title: item.title.slice(0, 200),
          url,
          snippet: (item.content || "").slice(0, 1500),
        });
        if (sources.length === 5) break;
      }
      return sources;
    },
    async *answer(query, sources, history, signal) {
      if (!sources.length) {
        yield "I couldn't find usable sources for this question. Try a more specific search.";
        return;
      }
      if (config.aiProvider === "none") {
        yield "Sources-only mode: these are retrieved excerpts, not an AI-synthesized answer.\n\n";
        for (const source of sources) {
          signal.throwIfAborted();
          yield `${source.title} [${source.id}]\n${source.snippet || "Open this source to read more."}\n\n`;
        }
        return;
      }
      const response = await http("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.groqModel,
          stream: true,
          temperature: 0.2,
          max_completion_tokens: 1024,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildPrompt(query, sources, history) },
          ],
        }),
        signal,
      });
      if (!response.ok || !response.body)
        throw new AppError(
          503,
          "ANSWER_UNAVAILABLE",
          "The answer provider is temporarily unavailable. Your sources are still available.",
        );
      let finished = false;
      for await (const data of readSse(response.body)) {
        if (data === "[DONE]") {
          if (!finished)
            throw new AppError(
              502,
              "INCOMPLETE_STREAM",
              "The answer was interrupted. Your sources are still available.",
            );
          return;
        }
        const packet = z
          .object({
            choices: z.array(
              z.object({
                delta: z.object({ content: z.string().nullable().optional() }),
                finish_reason: z.string().nullable().optional(),
              }),
            ),
          })
          .safeParse(JSON.parse(data));
        if (!packet.success)
          throw new AppError(
            502,
            "INVALID_STREAM",
            "The answer provider sent an invalid response.",
          );
        const choice = packet.data.choices[0];
        if (choice?.delta.content) yield choice.delta.content;
        if (choice?.finish_reason) {
          if (choice.finish_reason !== "stop")
            throw new AppError(
              502,
              "INCOMPLETE_ANSWER",
              "The answer reached its limit before finishing. Try a narrower question.",
            );
          finished = true;
        }
      }
      throw new AppError(502, "INCOMPLETE_STREAM", "The answer stream ended unexpectedly.");
    },
    async verifyGuest(token, ip, signal) {
      if (!config.turnstileSecret) {
        if (config.production)
          throw new AppError(
            503,
            "GUESTS_UNAVAILABLE",
            "Guest search is not enabled yet. Please sign in.",
          );
        return;
      }
      if (!token)
        throw new AppError(
          400,
          "BOT_CHECK_REQUIRED",
          "Complete the verification before searching.",
        );
      const response = await http("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: config.turnstileSecret, response: token, remoteip: ip }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok)
        throw new AppError(
          503,
          "BOT_CHECK_UNAVAILABLE",
          "Verification is temporarily unavailable.",
        );
      const result = (await response.json()) as {
        success?: boolean;
        hostname?: string;
        action?: string;
      };
      if (
        !result.success ||
        result.action !== "search" ||
        !config.origins.some((o) => new URL(o).hostname === result.hostname)
      ) {
        throw new AppError(403, "BOT_CHECK_FAILED", "Verification failed. Please try again.");
      }
    },
  };
}
