/**
 * GitHub pull-request acquisition.
 *
 * An alternative input to a local git range: read a single PR's title, body,
 * and commit list straight from the GitHub REST API. Uses the built-in `fetch`
 * (Node 18+) — no extra dependency. A token (`GITHUB_TOKEN`) is optional but
 * recommended to raise the rate limit and reach private repos.
 */

import type { ChangeSet, Commit, FileChange } from "./git.js";
import { shapeDiff } from "./diff.js";

/** Thrown when the GitHub API request fails. */
export class GitHubError extends Error {
  override readonly name = "GitHubError";
}

/** A parsed `owner/repo#number` reference. */
export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** Parse a PR reference like `vercel/ai#1234` or a full PR URL. */
export function parsePrRef(input: string): PrRef {
  const url = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (url) {
    return { owner: url[1] as string, repo: url[2] as string, number: Number.parseInt(url[3] as string, 10) };
  }
  const short = input.match(/^([^/]+)\/([^/#]+)#(\d+)$/);
  if (short) {
    return { owner: short[1] as string, repo: short[2] as string, number: Number.parseInt(short[3] as string, 10) };
  }
  throw new GitHubError(`Could not parse a pull-request reference from "${input}". Use owner/repo#123 or a PR URL.`);
}

interface GhCommit {
  sha: string;
  commit: { message: string; author: { name?: string; date?: string } };
}

interface GhFile {
  filename: string;
  additions?: number;
  deletions?: number;
  /** The unified-diff hunk for this file. Absent for binary/very large files. */
  patch?: string;
}

/** Options for {@link collectPullRequest}. */
export interface CollectPrOptions {
  /** Capture and shape the PR diff. Default true. */
  includeDiff?: boolean;
  /** Per-file diff line cap. Default 200. */
  maxLinesPerFile?: number;
  /** Total diff line cap. Default 1500. */
  maxTotalLines?: number;
}

/**
 * Reconstruct a unified-diff header for a PR file so the shared {@link shapeDiff}
 * can classify and truncate it exactly like a local `git diff`. The GitHub
 * `patch` field omits the `diff --git` / `+++` lines, so we add them back.
 */
function toUnifiedDiff(files: GhFile[]): string {
  const blocks: string[] = [];
  for (const f of files) {
    if (!f.patch) continue; // binary/too-large: no textual patch from the API
    blocks.push(`diff --git a/${f.filename} b/${f.filename}`);
    blocks.push(`--- a/${f.filename}`);
    blocks.push(`+++ b/${f.filename}`);
    blocks.push(f.patch);
  }
  return blocks.join("\n");
}

async function gh(path: string, token: string | undefined): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo2post",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    const hint = res.status === 403 ? " (rate limited — set GITHUB_TOKEN)" : res.status === 404 ? " (not found or private)" : "";
    throw new GitHubError(`GitHub API ${res.status} for ${path}${hint}`);
  }
  return res.json();
}

/**
 * Fetch a pull request and return it as a {@link ChangeSet}, so the rest of the
 * pipeline treats a PR exactly like a local git range.
 *
 * @throws {@link GitHubError} on a failed request.
 */
export async function collectPullRequest(
  ref: PrRef,
  token?: string,
  options: CollectPrOptions = {},
): Promise<ChangeSet & { title: string; description: string }> {
  const base = `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const pr = (await gh(base, token)) as {
    title?: string;
    body?: string;
    base?: { ref?: string };
    head?: { ref?: string; sha?: string };
    additions?: number;
    deletions?: number;
  };
  const rawCommits = (await gh(`${base}/commits?per_page=100`, token)) as GhCommit[];
  const rawFiles = (await gh(`${base}/files?per_page=100`, token)) as GhFile[];

  const commits: Commit[] = rawCommits.map((rc) => {
    const message = rc.commit.message ?? "";
    const nl = message.indexOf("\n");
    const subject = nl === -1 ? message : message.slice(0, nl);
    const body = nl === -1 ? "" : message.slice(nl + 1).trim();
    return {
      hash: rc.sha,
      short: rc.sha.slice(0, 7),
      subject: subject.trim(),
      body,
      author: rc.commit.author?.name ?? "",
      date: rc.commit.author?.date ?? "",
    };
  });

  const files: FileChange[] = rawFiles.map((f) => ({
    path: f.filename,
    insertions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
  }));

  const result: ChangeSet & { title: string; description: string } = {
    from: pr.base?.ref ?? "",
    to: pr.head?.ref ?? pr.head?.sha ?? "",
    commits,
    files,
    insertions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    title: pr.title ?? `Pull request #${ref.number}`,
    description: (pr.body ?? "").trim(),
  };

  if (options.includeDiff !== false) {
    result.diff = shapeDiff(toUnifiedDiff(rawFiles), {
      ...(options.maxLinesPerFile !== undefined ? { maxLinesPerFile: options.maxLinesPerFile } : {}),
      ...(options.maxTotalLines !== undefined ? { maxTotalLines: options.maxTotalLines } : {}),
    });
  }

  return result;
}
