import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPullRequest, GitHubError, parsePrRef } from "../src/github.js";

describe("parsePrRef", () => {
  it("parses owner/repo#number", () => {
    expect(parsePrRef("vercel/ai#1234")).toEqual({ owner: "vercel", repo: "ai", number: 1234 });
  });
  it("parses a full PR URL", () => {
    expect(parsePrRef("https://github.com/VTX-Labs/repo2post/pull/7")).toEqual({
      owner: "VTX-Labs",
      repo: "repo2post",
      number: 7,
    });
  });
  it("throws on garbage", () => {
    expect(() => parsePrRef("not-a-pr")).toThrow(GitHubError);
  });
});

describe("collectPullRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(responders: Record<string, unknown>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        for (const [match, body] of Object.entries(responders)) {
          if (url.includes(match)) {
            return { ok: true, status: 200, json: async () => body } as Response;
          }
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }),
    );
  }

  it("maps a PR and its commits into a ChangeSet", async () => {
    stubFetch({
      "/pulls/1234/commits": [
        { sha: "a".repeat(40), commit: { message: "feat: thing\n\nbody here", author: { name: "Bankk", date: "2026-06-01T00:00:00Z" } } },
        { sha: "b".repeat(40), commit: { message: "fix: bug", author: { name: "Bankk", date: "2026-06-02T00:00:00Z" } } },
      ],
      "/pulls/1234": {
        title: "Add thing",
        body: "Adds a thing.",
        base: { ref: "main" },
        head: { ref: "feature", sha: "c".repeat(40) },
        additions: 50,
        deletions: 10,
      },
    });

    const cs = await collectPullRequest({ owner: "vercel", repo: "ai", number: 1234 });
    expect(cs.title).toBe("Add thing");
    expect(cs.description).toBe("Adds a thing.");
    expect(cs.from).toBe("main");
    expect(cs.to).toBe("feature");
    expect(cs.insertions).toBe(50);
    expect(cs.deletions).toBe(10);
    expect(cs.commits).toHaveLength(2);
    expect(cs.commits[0]).toMatchObject({ subject: "feat: thing", body: "body here", short: "aaaaaaa" });
    expect(cs.commits[1]).toMatchObject({ subject: "fix: bug", body: "" });
  });

  it("surfaces a helpful error on 403 rate limiting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response),
    );
    await expect(collectPullRequest({ owner: "x", repo: "y", number: 1 })).rejects.toThrow(/rate limited/);
  });

  it("sends the auth header when a token is provided", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer tok123");
      return { ok: true, status: 200, json: async () => (_url.includes("/commits") ? [] : { title: "t", head: {}, base: {} }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    await collectPullRequest({ owner: "x", repo: "y", number: 1 }, "tok123");
    expect(fetchMock).toHaveBeenCalled();
  });
});
