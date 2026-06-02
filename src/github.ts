/**
 * GitHub pull-request acquisition.
 *
 * An alternative input to a local git range: read a single PR's title, body,
 * and commit list straight from the GitHub REST API. Uses the built-in `fetch`
 * (Node 18+) — no extra dependency. A token (`GITHUB_TOKEN`) is optional but
 * recommended to raise the rate limit and reach private repos.
 */

import type { ChangeSet, Commit } from "./git.js";

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
export async function collectPullRequest(ref: PrRef, token?: string): Promise<ChangeSet & { title: string; description: string }> {
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

  return {
    from: pr.base?.ref ?? "",
    to: pr.head?.ref ?? pr.head?.sha ?? "",
    commits,
    files: [],
    insertions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    title: pr.title ?? `Pull request #${ref.number}`,
    description: (pr.body ?? "").trim(),
  };
}
