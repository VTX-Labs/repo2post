/**
 * @vtx-labs/repo2post — programmatic API.
 *
 * Turn a git range, tag diff, or pull request into a release blog post,
 * changelog, release notes, launch thread, or technical breakdown — with a
 * single AI call. The library reads the change set from git (read-only), builds
 * a grounded prompt in the chosen style, and generates the content through the
 * AI SDK (any `provider/model` string, routed via the Vercel AI Gateway).
 *
 * @example
 * ```ts
 * import { collectChanges, generatePost } from "@vtx-labs/repo2post";
 *
 * const changes = await collectChanges({ from: "v1.0.0", to: "v1.1.0" });
 * const post = await generatePost(
 *   { changes, style: "changelog", project: "my-lib" },
 *   { model: "anthropic/claude-sonnet-4.5" },
 * );
 * console.log(post.content);
 * ```
 */

export { collectChanges, listTags, GitError } from "./git.js";
export type { ChangeSet, Commit, FileChange, CollectOptions } from "./git.js";

export { shapeDiff, classifyPath, splitUnifiedDiff } from "./diff.js";
export type { ShapedDiff, FileDiff, SkipReason, ShapeDiffOptions } from "./diff.js";

export { collectPullRequest, parsePrRef, GitHubError } from "./github.js";
export type { PrRef, CollectPrOptions } from "./github.js";

export { buildPrompt } from "./prompt.js";
export type { PromptInput, BuiltPrompt } from "./prompt.js";

export { getStyle, allStyles, isStyleName, STYLE_NAMES } from "./styles.js";
export type { Style, StyleName } from "./styles.js";

export { DEFAULT_MODEL, MODELS, isValidModelId } from "./models.js";
export type { ModelChoice } from "./models.js";

export { generatePost } from "./generate.js";
export type {
  GenerateOptions,
  GeneratedPost,
  GenerateTextFn,
  GenerateTextArgs,
  GenerateTextResult,
} from "./generate.js";
