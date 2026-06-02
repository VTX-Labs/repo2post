/**
 * Model selection.
 *
 * Models are plain `"provider/model"` strings: in AI SDK 6 such a string routes
 * through the Vercel AI Gateway automatically, giving access to every major
 * provider with a single `AI_GATEWAY_API_KEY`. You can pass *any* gateway model
 * id; the list below is a curated set of strong, current defaults surfaced in
 * `--help` and validated for obvious typos.
 */

/** The default model when none is specified. */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

/** A curated model with a short label for the picker. */
export interface ModelChoice {
  id: string;
  label: string;
}

/** Recommended models, grouped loosely by provider. Not exhaustive. */
export const MODELS: ModelChoice[] = [
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 — balanced default" },
  { id: "anthropic/claude-opus-4.1", label: "Claude Opus 4.1 — highest quality" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5 — fast & cheap" },
  { id: "openai/gpt-5", label: "OpenAI GPT-5" },
  { id: "openai/gpt-5-mini", label: "OpenAI GPT-5 mini — fast & cheap" },
  { id: "google/gemini-2.5-pro", label: "Google Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash", label: "Google Gemini 2.5 Flash — fast & cheap" },
  { id: "xai/grok-4", label: "xAI Grok 4" },
];

/**
 * Validate a model id. Any non-empty `provider/model` string is accepted (the
 * gateway resolves it); this only rejects shapes that are clearly wrong so the
 * user gets a fast, local error instead of an opaque API failure.
 */
export function isValidModelId(id: string): boolean {
  if (!id || id.includes(" ")) return false;
  // Expect a single provider/model separator with non-empty halves.
  const parts = id.split("/");
  return parts.length >= 2 && parts.every((p) => p.length > 0);
}
