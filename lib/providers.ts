import { boundedJson } from "./bounded-json.js";
import { z } from "zod";
import { boundedPrompt, SYSTEM_PROMPT } from "../prompts.js";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { readSse } from "./sse.js";
import type { Providers, Source } from "./types.js";
import { APPROVED_MODELS, modelCatalogue } from "./models.js";
import type { ModelAttribution, ModelCatalogue } from "./models.js";
import { AnswerSections } from "./follow-ups.js";

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
  let cached: { catalogue: ModelCatalogue; expiresAt: number } | undefined;
  let pending: Promise<ModelCatalogue> | undefined;
  const blocked = new Map<string, { until: number; reason: string }>();
  async function models(): Promise<ModelCatalogue> {
    if (config.aiProvider !== "groq") return modelCatalogue(config, new Set());
    if (!cached || cached.expiresAt <= Date.now()) {
      pending ??= (async () => {
        const response = await http("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${config.groqKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok)
          throw new AppError(
            503,
            "MODEL_CATALOGUE_UNAVAILABLE",
            "Model availability could not be checked. Refresh models and try again.",
          );
        const parsed = z.object({
          data: z.array(z.object({ id: z.string(), active: z.boolean().optional() })),
        }).safeParse(await boundedJson(response, 131072));
        if (!parsed.success)
          throw new AppError(
            503,
            "MODEL_CATALOGUE_UNAVAILABLE",
            "Model availability could not be checked. Refresh models and try again.",
          );
        const catalogue = modelCatalogue(
          config,
          new Set(parsed.data.data.filter((model) => model.active !== false).map((model) => model.id)),
        );
        cached = { catalogue, expiresAt: Date.now() + 60000 };
        return catalogue;
      })();
      try {
        await pending;
      } finally {
        pending = undefined;
      }
    }
    return {
      ...cached!.catalogue,
      models: cached!.catalogue.models.map((model) => {
        const failure = blocked.get(model.id);
        return failure && failure.until > Date.now()
          ? { ...model, available: false, unavailableReason: failure.reason }
          : { ...model };
      }),
    };
  }
  return {
    models,
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
      const parsed = resultsSchema.safeParse(await boundedJson(response, 262144));
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
    async *answer(query, sources, history, signal, modelId = config.groqModel, maxOutputTokens) {
      if (!sources.length) {
        yield "I couldn't find usable sources for this question. Try a more specific search.";
        return null;
      }
      if (config.aiProvider === "none") {
        yield "Sources-only mode: these are retrieved excerpts, not an AI-synthesized answer.\n\n";
        for (const source of sources) {
          signal.throwIfAborted();
          yield `${source.title} [${source.id}]\n${source.snippet || "Open this source to read more."}\n\n`;
        }
        return null;
      }
      const approved = APPROVED_MODELS.find((model) => model.id === modelId);
      if (!approved) throw new AppError(400, "UNKNOWN_MODEL", "Select an approved model.");
      // The route has already checked live availability and reserved quota.
      const model = modelCatalogue(config, new Set([modelId])).models.find(
        (model) => model.id === modelId,
      )!;
      let prompt: string;
      try {
        prompt = boundedPrompt(query, sources, history, model.maxInputBytes);
      } catch {
        throw new AppError(
          400,
          "INPUT_LIMIT",
          "This question exceeds the model input limit. Try a shorter question.",
        );
      }
      const response = await http("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          stream: true,
          temperature: 0.2,
          max_completion_tokens: Math.min(
            model.maxOutputTokens,
            Math.max(1, maxOutputTokens ?? model.maxOutputTokens),
          ),
          // GPT-OSS reasons too. Keep effort small and stream only its final answer.
          ...(["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(modelId)
            ? { reasoning_effort: "low", include_reasoning: false }
            : modelId === "qwen/qwen3.8-27b"
              ? { reasoning_effort: "none", include_reasoning: false }
              : {}),
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
        signal,
      });
      if ([403, 404].includes(response.status)) {
        const permission = response.status === 403;
        const message = permission
          ? "Groq has restricted this model for the configured account or project. Select another available model."
          : "This model is no longer available on Groq. Select another available model.";
        blocked.set(modelId, { until: Date.now() + 60000, reason: message });
        throw new AppError(409, permission ? "MODEL_PERMISSION" : "MODEL_UNAVAILABLE", message);
      }
      if (response.status === 429)
        throw new AppError(
          429,
          "MODEL_RATE_LIMIT",
          "Groq's free allowance is busy or exhausted. Wait before sending another question.",
          Number(response.headers.get("Retry-After")) || 60,
        );
      if (!response.ok || !response.body)
        throw new AppError(
          503,
          "ANSWER_UNAVAILABLE",
          "The answer provider is temporarily unavailable. Your sources are still available.",
        );
      let finished = false;
      let actual: ModelAttribution | null = null;
      const sections = new AnswerSections();
      let hasAnswer = false;
      for await (const data of readSse(response.body)) {
        if (data === "[DONE]") {
          if (!finished)
            throw new AppError(
              502,
              "INCOMPLETE_STREAM",
              "The answer was interrupted. Your sources are still available.",
            );
          if (!actual)
            throw new AppError(502, "MODEL_UNCONFIRMED", "The provider did not confirm the answer's model. This answer is incomplete.");
          return actual;
        }
        const packet = z
          .object({
            model: z.string().optional(),
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
        if (packet.data.model) {
          if (packet.data.model !== modelId)
            throw new AppError(502, "MODEL_MISMATCH", "The provider returned a different model. No completed answer was recorded. Try again later.");
          actual = { ...approved, provider: "Groq" };
        }
        const choice = packet.data.choices[0];
        if (choice?.delta.content) {
          const visible = sections.push(choice.delta.content);
          hasAnswer = hasAnswer || !!visible.trim();
          yield choice.delta.content;
        }
        if (choice?.finish_reason) {
          // A token cap in the optional footer cannot undo an already completed
          // answer. The exact boundary, confirmed model and [DONE] remain required.
          if (choice.finish_reason !== "stop" && !(choice.finish_reason === "length" && hasAnswer && sections.hasAnswerBoundary))
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
      const result = (await boundedJson(response, 16384)) as {
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
