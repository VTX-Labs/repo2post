/**
 * The generation step: change set + style → finished post.
 *
 * This wraps the AI SDK's `generateText`. In AI SDK 6 a plain `"provider/model"`
 * string routes through the Vercel AI Gateway automatically, so the model is
 * just a string and the only credential needed is `AI_GATEWAY_API_KEY` (or a
 * provider key the gateway recognizes).
 *
 * The actual `generateText` call is injected (defaulting to the real one), so
 * the pipeline is fully unit-testable without a network or API key.
 */

import { buildPrompt, type PromptInput } from "./prompt.js";
import { DEFAULT_MODEL } from "./models.js";

/** The subset of AI SDK `generateText` we rely on. */
export interface GenerateTextArgs {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

/** The subset of the AI SDK result we read. */
export interface GenerateTextResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  finishReason?: string;
}

/** A function matching the AI SDK's `generateText` shape. */
export type GenerateTextFn = (args: GenerateTextArgs) => Promise<GenerateTextResult>;

/** Options for {@link generatePost}. */
export interface GenerateOptions extends Omit<PromptInput, "changes" | "style"> {
  /** Model id, e.g. `"anthropic/claude-sonnet-4.5"`. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /** Sampling temperature. Default 0.4 — factual, lightly varied. */
  temperature?: number;
  /** Output token cap. Default 2048. */
  maxOutputTokens?: number;
  /** Abort signal forwarded to the model call. */
  abortSignal?: AbortSignal;
  /**
   * Inject a `generateText` implementation. Defaults to the AI SDK's, loaded
   * lazily so importing this module never requires the `ai` package to resolve
   * a model or read credentials until a generation actually runs.
   */
  generateText?: GenerateTextFn;
}

/** The finished generation plus the metadata about how it was produced. */
export interface GeneratedPost {
  content: string;
  model: string;
  style: PromptInput["style"];
  usage?: GenerateTextResult["usage"];
  finishReason?: string;
}

let cachedGenerateText: GenerateTextFn | undefined;

/** Lazily import the real AI SDK `generateText`, caching it. */
async function loadGenerateText(): Promise<GenerateTextFn> {
  if (cachedGenerateText) return cachedGenerateText;
  const mod = (await import("ai")) as { generateText: (args: GenerateTextArgs) => Promise<GenerateTextResult> };
  cachedGenerateText = mod.generateText;
  return cachedGenerateText;
}

/**
 * Generate a post from a change set in the given style.
 *
 * @param input the change set and style (from {@link PromptInput})
 * @param options model, sampling, and an optional injected `generateText`
 */
export async function generatePost(
  input: PromptInput,
  options: GenerateOptions = {},
): Promise<GeneratedPost> {
  const model = options.model ?? DEFAULT_MODEL;
  const temperature = options.temperature ?? 0.4;
  const maxOutputTokens = options.maxOutputTokens ?? 2048;

  const built = buildPrompt({
    ...input,
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(options.guidance !== undefined ? { guidance: options.guidance } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.maxCommits !== undefined ? { maxCommits: options.maxCommits } : {}),
    ...(options.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {}),
  });

  const generateText = options.generateText ?? (await loadGenerateText());

  const result = await generateText({
    model,
    system: built.system,
    prompt: built.prompt,
    temperature,
    maxOutputTokens,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
  });

  return {
    content: result.text.trim(),
    model,
    style: input.style,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
  };
}
