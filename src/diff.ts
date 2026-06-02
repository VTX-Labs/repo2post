/**
 * Diff capture and shaping.
 *
 * Commit messages and file names alone are thin signal — if the messages are
 * vague ("wip", "fix"), the model has nothing concrete to write from. Including
 * the actual patch fixes that, but a raw diff is dangerous (it can carry
 * secrets) and unbounded (it can blow the context budget). This module turns a
 * raw `git diff` patch into a *shaped* set of per-file diffs:
 *
 *   - sensitive / generated / binary files are skipped entirely (by path),
 *   - each remaining file's hunk text is capped to a per-file line budget,
 *   - the total is capped, and anything dropped is recorded transparently.
 *
 * The result lists exactly what was included and what was omitted, so the
 * prompt can be honest about coverage and the user can see it too.
 */

/** A single file's (possibly truncated) diff. */
export interface FileDiff {
  path: string;
  /** The unified-diff hunk text for this file, after truncation. */
  patch: string;
  /** True when this file's patch was cut to fit the per-file budget. */
  truncated: boolean;
}

/** The shaped diff: what made it in, and what didn't (and why). */
export interface ShapedDiff {
  files: FileDiff[];
  /** Files skipped by the sensitive/generated/binary filter, with the reason. */
  skipped: Array<{ path: string; reason: SkipReason }>;
  /** Files dropped because the total budget was already spent. */
  omittedForBudget: string[];
  /** Total diff lines actually included across all files. */
  includedLines: number;
}

/** Why a file's diff was excluded. */
export type SkipReason = "sensitive" | "generated" | "binary";

/** Options for {@link shapeDiff}. */
export interface ShapeDiffOptions {
  /** Max diff lines kept per file before truncating. Default 200. */
  maxLinesPerFile?: number;
  /** Max diff lines across all files. Default 1500. */
  maxTotalLines?: number;
}

// Exact filenames whose contents are secrets or pure noise in a write-up.
const SENSITIVE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".npmrc",
  ".netrc",
  "credentials",
  "secrets.json",
  "id_rsa",
  "id_ed25519",
]);

// Path/extension patterns for files that hold secrets.
const SENSITIVE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /\.(pem|key|pfx|p12|keystore|jks)$/i,
  /(^|\/)(secret|secrets|credential|credentials)(\.|\/|$)/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.ssh\//i,
];

// Generated / vendored / lockfile paths — real changes, but not worth narrating
// and often huge. Excluded from the diff (still counted in the file stats).
const GENERATED_PATTERNS: RegExp[] = [
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|composer\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum)$/i,
  /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.nuxt|vendor|__snapshots__)\//i,
  /(^|\/)[^/]+\.min\.(js|css)$/i,
  /\.map$/i,
];

// Binary / asset extensions: a textual diff is meaningless.
const BINARY_PATTERNS: RegExp[] = [
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|pdf|zip|gz|tar|tgz|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|wasm|exe|dll|so|dylib|class|jar)$/i,
];

/** Classify a path; returns a {@link SkipReason} or null if it should be kept. */
export function classifyPath(path: string): SkipReason | null {
  const name = path.split("/").pop() ?? path;
  if (SENSITIVE_NAMES.has(name)) return "sensitive";
  if (SENSITIVE_PATTERNS.some((re) => re.test(path))) return "sensitive";
  if (BINARY_PATTERNS.some((re) => re.test(path))) return "binary";
  if (GENERATED_PATTERNS.some((re) => re.test(path))) return "generated";
  return null;
}

/**
 * Split a unified `git diff` into per-file sections.
 *
 * Each section starts at a `diff --git a/… b/…` header. The file path is taken
 * from the `+++ b/…` line when present (handles renames), falling back to the
 * `diff --git` header.
 */
export function splitUnifiedDiff(patch: string): Array<{ path: string; text: string; binary: boolean }> {
  const sections: Array<{ path: string; text: string; binary: boolean }> = [];
  if (!patch.trim()) return sections;

  const lines = patch.split("\n");
  let current: { headerPath: string; plusPath: string | null; lines: string[]; binary: boolean } | null = null;

  const flush = () => {
    if (!current) return;
    const path = current.plusPath ?? current.headerPath;
    sections.push({ path, text: current.lines.join("\n").trimEnd(), binary: current.binary });
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const headerPath = m ? (m[2] as string) : line.slice("diff --git ".length);
      current = { headerPath, plusPath: null, lines: [line], binary: false };
      continue;
    }
    if (!current) continue; // preamble before the first header (rare); ignore
    current.lines.push(line);
    if (line.startsWith("+++ b/")) current.plusPath = line.slice("+++ b/".length);
    else if (line.startsWith("Binary files ") || line.includes("GIT binary patch")) current.binary = true;
  }
  flush();
  return sections;
}

/** Truncate a file's patch to `maxLines`, keeping the header context. */
function truncatePatch(text: string, maxLines: number): { patch: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { patch: text, truncated: false };
  const kept = lines.slice(0, maxLines);
  kept.push(`… (${lines.length - maxLines} more diff lines truncated)`);
  return { patch: kept.join("\n"), truncated: true };
}

/**
 * Shape a raw unified diff: drop sensitive/generated/binary files, truncate each
 * remaining file to the per-file budget, and stop including files once the total
 * budget is spent (recording what was omitted).
 */
export function shapeDiff(rawPatch: string, options: ShapeDiffOptions = {}): ShapedDiff {
  const maxLinesPerFile = options.maxLinesPerFile ?? 200;
  const maxTotalLines = options.maxTotalLines ?? 1500;

  const result: ShapedDiff = { files: [], skipped: [], omittedForBudget: [], includedLines: 0 };
  const sections = splitUnifiedDiff(rawPatch);

  for (const section of sections) {
    const reason = section.binary ? "binary" : classifyPath(section.path);
    if (reason) {
      result.skipped.push({ path: section.path, reason });
      continue;
    }

    if (result.includedLines >= maxTotalLines) {
      result.omittedForBudget.push(section.path);
      continue;
    }

    const remaining = maxTotalLines - result.includedLines;
    const perFile = Math.min(maxLinesPerFile, remaining);
    const { patch, truncated } = truncatePatch(section.text, perFile);
    const lineCount = patch.split("\n").length;
    result.files.push({ path: section.path, patch, truncated });
    result.includedLines += lineCount;
  }

  return result;
}
