/**
 * Git history acquisition.
 *
 * repo2post writes about what *changed*, so the first job is to read that
 * change out of a local git repository. We shell out to the `git` binary (it is
 * always present where a repo is) rather than depend on a git library — that
 * keeps the runtime dependency footprint to just the AI SDK.
 *
 * Everything here is read-only: `git log`, `git diff`, `git tag`. We never write
 * to the repository. By default the actual patch is captured too (shaped by
 * `diff.ts`: sensitive/generated/binary files skipped, per-file + total caps) so
 * the model can write from real changes, not just commit messages.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { shapeDiff, type ShapedDiff } from "./diff.js";

const exec = promisify(execFile);

/** Thrown when a git command fails or the directory is not a repository. */
export class GitError extends Error {
  override readonly name = "GitError";
}

/** One commit in the range, parsed from `git log`. */
export interface Commit {
  hash: string;
  /** Abbreviated hash (first 7 chars). */
  short: string;
  subject: string;
  body: string;
  author: string;
  /** ISO-8601 author date. */
  date: string;
}

/** A per-file change summary from `git diff --numstat`. */
export interface FileChange {
  path: string;
  insertions: number;
  deletions: number;
}

/** The collected change set between two refs. */
export interface ChangeSet {
  /** The resolved "from" ref (exclusive). May be empty for the repo root. */
  from: string;
  /** The resolved "to" ref (inclusive). */
  to: string;
  commits: Commit[];
  files: FileChange[];
  /** Total insertions / deletions across the range. */
  insertions: number;
  deletions: number;
  /**
   * The shaped patch for the range, when diff capture is enabled (the default).
   * Undefined when disabled via `includeDiff: false`. Sensitive, generated, and
   * binary files are skipped; per-file and total line caps apply.
   */
  diff?: ShapedDiff;
}

/** Options for {@link collectChanges}. */
export interface CollectOptions {
  /** Working directory of the repository. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Start ref (exclusive). If omitted, uses the previous tag, else the root. */
  from?: string;
  /** End ref (inclusive). Defaults to `HEAD`. */
  to?: string;
  /** Cap on commits collected (newest first). Default 200. */
  maxCommits?: number;
  /** Capture and shape the actual patch. Default true. */
  includeDiff?: boolean;
  /** Per-file diff line cap (forwarded to {@link shapeDiff}). Default 200. */
  maxLinesPerFile?: number;
  /** Total diff line cap (forwarded to {@link shapeDiff}). Default 1500. */
  maxTotalLines?: number;
}

// ASCII unit-separator / record-separator delimiters that will not appear in
// commit metadata, so splitting the `git log` output is unambiguous.
const FIELD = String.fromCharCode(0x1f);
const RECORD = String.fromCharCode(0x1e);

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const msg = (err as { stderr?: string; message?: string }).stderr?.trim() || (err as Error).message;
    throw new GitError(`git ${args.join(" ")} failed: ${msg}`);
  }
}

async function isRepo(cwd: string): Promise<boolean> {
  try {
    const out = await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

/** The most recent tag reachable before `ref`, or null if there isn't one. */
async function previousTag(ref: string, cwd: string): Promise<string | null> {
  try {
    const out = await git(["describe", "--tags", "--abbrev=0", `${ref}^`], cwd);
    return out.trim() || null;
  } catch {
    // No tags, or ref has no parent (root commit).
    return null;
  }
}

function parseLog(stdout: string): Commit[] {
  const commits: Commit[] = [];
  for (const record of stdout.split(RECORD)) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const [hash, author, date, subject, body = ""] = trimmed.split(FIELD);
    if (!hash || subject === undefined) continue;
    commits.push({
      hash,
      short: hash.slice(0, 7),
      author: author ?? "",
      date: date ?? "",
      subject,
      body: body.trim(),
    });
  }
  return commits;
}

/** Parse the per-file lines of `git diff --numstat`. */
function parseNumstat(stdout: string): { files: FileChange[]; insertions: number; deletions: number } {
  const files: FileChange[] = [];
  let insertions = 0;
  let deletions = 0;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const [ins, del, path] = parts;
    // Binary files show "-" for counts.
    const i = ins === "-" ? 0 : Number.parseInt(ins ?? "0", 10) || 0;
    const d = del === "-" ? 0 : Number.parseInt(del ?? "0", 10) || 0;
    files.push({ path: path ?? "", insertions: i, deletions: d });
    insertions += i;
    deletions += d;
  }
  return { files, insertions, deletions };
}

/**
 * Collect the change set for a git range. Resolves a sensible default range
 * (previous tag → HEAD) when `from`/`to` are omitted.
 *
 * @throws {@link GitError} if the directory is not a repo or git fails.
 */
export async function collectChanges(options: CollectOptions = {}): Promise<ChangeSet> {
  const cwd = options.cwd ?? process.cwd();
  const maxCommits = options.maxCommits ?? 200;

  if (!(await isRepo(cwd))) {
    throw new GitError(`Not a git repository: ${cwd}`);
  }

  const to = (options.to ?? "HEAD").trim();
  let from = options.from?.trim() ?? "";
  if (!from) {
    from = (await previousTag(to, cwd)) ?? "";
  }

  const range = from ? `${from}..${to}` : to;

  const format = ["%H", "%an", "%aI", "%s", "%b"].join(FIELD) + RECORD;
  const logOut = await git(["log", `--max-count=${maxCommits}`, `--pretty=format:${format}`, range], cwd);
  const commits = parseLog(logOut);

  // `git diff A..B` compares endpoints; `git diff <ref>` (no `..`) needs the ref
  // spelled out for both numstat and patch. Build the spec once.
  const spec = from ? `${from}..${to}` : to;
  const numstatOut = await git(["diff", "--numstat", spec], cwd);
  const { files, insertions, deletions } = parseNumstat(numstatOut);

  const changeSet: ChangeSet = { from, to, commits, files, insertions, deletions };

  if (options.includeDiff !== false) {
    // -M detects renames (shorter, clearer patches); no color so it parses cleanly.
    const rawPatch = await git(["diff", "-M", "--no-color", spec], cwd);
    changeSet.diff = shapeDiff(rawPatch, {
      ...(options.maxLinesPerFile !== undefined ? { maxLinesPerFile: options.maxLinesPerFile } : {}),
      ...(options.maxTotalLines !== undefined ? { maxTotalLines: options.maxTotalLines } : {}),
    });
  }

  return changeSet;
}

/** List tags newest-first (by creation date), capped at `limit`. */
export async function listTags(cwd: string, limit = 20): Promise<string[]> {
  if (!(await isRepo(cwd))) throw new GitError(`Not a git repository: ${cwd}`);
  const out = await git(["tag", "--sort=-creatordate"], cwd);
  return out
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, limit);
}
