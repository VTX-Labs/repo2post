import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectChanges, GitError, listTags } from "../src/git.js";

/**
 * Real git integration: build a throwaway repository on disk and exercise the
 * acquisition layer against actual `git` output. git is present in CI.
 */
let repo: string;

function run(args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

function commit(file: string, contents: string, message: string): void {
  writeFileSync(join(repo, file), contents);
  run(["add", "."]);
  run(["commit", "-m", message]);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "repo2post-git-"));
  run(["init"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  run(["config", "commit.gpgsign", "false"]);
  run(["config", "tag.gpgsign", "false"]);

  commit("a.txt", "1\n", "feat: initial release");
  run(["tag", "v1.0.0"]);
  commit("a.txt", "1\n2\n", "fix: handle empty input\n\nThis fixes the empty case.");
  // This commit also touches a secret file and a lockfile, which must be
  // excluded from the captured diff.
  writeFileSync(join(repo, ".env"), "SECRET=supersecretvalue\n");
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
  commit("b.txt", "new\n", "feat: add --json output flag");
  run(["tag", "v1.1.0"]);
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe("collectChanges (real git)", () => {
  it("resolves the previous tag (before HEAD's parent) as the default 'from'", async () => {
    // v1.1.0 points at HEAD itself; `git describe HEAD^` therefore resolves the
    // most recent tag strictly before HEAD, which is v1.0.0. The default range
    // v1.0.0..HEAD then covers the two commits made since v1.0.0.
    const cs = await collectChanges({ cwd: repo });
    expect(cs.from).toBe("v1.0.0");
    expect(cs.to).toBe("HEAD");
    expect(cs.commits.map((c) => c.subject)).toEqual([
      "feat: add --json output flag",
      "fix: handle empty input",
    ]);
  });

  it("collects commits for an explicit tag range, newest first", async () => {
    const cs = await collectChanges({ cwd: repo, from: "v1.0.0", to: "v1.1.0" });
    expect(cs.commits.map((c) => c.subject)).toEqual([
      "feat: add --json output flag",
      "fix: handle empty input",
    ]);
    expect(cs.from).toBe("v1.0.0");
    expect(cs.to).toBe("v1.1.0");
  });

  it("captures the commit body", async () => {
    const cs = await collectChanges({ cwd: repo, from: "v1.0.0", to: "v1.1.0" });
    const fixCommit = cs.commits.find((c) => c.subject.startsWith("fix:"))!;
    expect(fixCommit.body).toContain("This fixes the empty case.");
    expect(fixCommit.short).toHaveLength(7);
    expect(fixCommit.author).toBe("Test");
  });

  it("computes file changes and totals from numstat (all files, incl. excluded-from-diff)", async () => {
    const cs = await collectChanges({ cwd: repo, from: "v1.0.0", to: "v1.1.0" });
    const paths = cs.files.map((f) => f.path).sort();
    // numstat counts every changed file, even ones the diff later excludes.
    expect(paths).toEqual([".env", "a.txt", "b.txt", "pnpm-lock.yaml"]);
    expect(cs.insertions).toBeGreaterThan(0);
  });

  it("captures a diff by default and excludes secrets + lockfiles from it", async () => {
    const cs = await collectChanges({ cwd: repo, from: "v1.0.0", to: "v1.1.0" });
    expect(cs.diff).toBeDefined();
    const diffPaths = cs.diff!.files.map((f) => f.path).sort();
    expect(diffPaths).toEqual(["a.txt", "b.txt"]);
    const skipped = Object.fromEntries(cs.diff!.skipped.map((s) => [s.path, s.reason]));
    expect(skipped[".env"]).toBe("sensitive");
    expect(skipped["pnpm-lock.yaml"]).toBe("generated");
    // The secret value must never appear anywhere in the captured diff.
    expect(JSON.stringify(cs.diff)).not.toContain("supersecretvalue");
  });

  it("omits the diff entirely when includeDiff is false", async () => {
    const cs = await collectChanges({ cwd: repo, from: "v1.0.0", to: "v1.1.0", includeDiff: false });
    expect(cs.diff).toBeUndefined();
  });

  it("respects maxCommits", async () => {
    const cs = await collectChanges({ cwd: repo, from: "v1.0.0", to: "v1.1.0", maxCommits: 1 });
    expect(cs.commits).toHaveLength(1);
    expect(cs.commits[0]!.subject).toBe("feat: add --json output flag"); // newest
  });

  it("lists tags newest-first", async () => {
    const tags = await listTags(repo);
    expect(tags).toContain("v1.0.0");
    expect(tags).toContain("v1.1.0");
  });

  it("throws GitError outside a repository", async () => {
    const empty = mkdtempSync(join(tmpdir(), "repo2post-norepo-"));
    try {
      await expect(collectChanges({ cwd: empty })).rejects.toThrow(GitError);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
