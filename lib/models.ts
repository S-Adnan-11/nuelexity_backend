import type { Config } from "./config.js";
import { AppError } from "./errors.js";

// This is an owner-approved catalogue, never an import of every Groq model.
export const APPROVED_MODELS = [
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", preview: false },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", preview: false },
  { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", preview: true },
] as const;
export interface ModelAttribution {
  id: string;
  name: string;
  preview: boolean;
  provider: "Groq";
}
export interface ModelOption extends ModelAttribution {
  available: boolean;
  unavailableReason?: string;
  maxInputBytes: number;
  maxOutputTokens: number;
}
export interface ModelCatalogue {
  defaultModelId: string;
  models: ModelOption[];
}
export function modelCatalogue(config: Config, activeIds: Set<string>): ModelCatalogue {
  return {
    defaultModelId: config.groqModel,
    models: APPROVED_MODELS.map((model) => ({
      ...model,
      provider: "Groq",
      available: config.aiProvider === "groq" && activeIds.has(model.id),
      ...(config.aiProvider !== "groq"
        ? { unavailableReason: "AI answers are not enabled." }
        : !activeIds.has(model.id)
          ? { unavailableReason: "This model is currently unavailable on Groq." }
          : {}),
      // All three Free models currently have an 8K TPM base limit. UTF-8 bytes
      // bound input conservatively, leaving room for output and message framing.
      maxInputBytes: 6000,
      maxOutputTokens: 1024,
    })),
  };
}
export function selectModel(catalogue: ModelCatalogue, requested: string, userId: string | null) {
  const model = catalogue.models.find((entry) => entry.id === requested);
  if (!model)
    throw new AppError(
      400,
      "UNKNOWN_MODEL",
      "This model is no longer supported. Select an available model.",
    );
  if (!userId && requested !== catalogue.defaultModelId)
    throw new AppError(403, "MODEL_SIGN_IN_REQUIRED", "Sign in to choose a different model.");
  if (!model.available)
    throw new AppError(
      409,
      "MODEL_UNAVAILABLE",
      "This model is unavailable. Select an available model before searching.",
    );
  return model;
}
