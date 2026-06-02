import { describe, expect, it } from "vitest";
import type { ChangeSet } from "../src/git.js";
import { buildPrompt } from "../src/prompt.js";

function changeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    from: "v1.0.0",
    to: "HEAD",
    commits: [
      { hash: "a".repeat(40), short: "aaaaaaa", subject: "feat: add export flag", body: "Lets users export.", author: "Bankk", date: "2026-06-01T00:00:00Z" },
      { hash: "b".repeat(40), short: "bbbbbbb", subject: "fix: handle empty input", body: "", author: "Bankk", date: "2026-06-02T00:00:00Z" },
    ],
    files: [
      { path: "src/cli.ts", insertions: 40, deletions: 5 },
      { path: "src/index.ts", insertions: 3, deletions: 1 },
    ],
    insertions: 43,
    deletions: 6,
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("embeds the base grounding rule and the style instructions", () => {
    const { system } = buildPrompt({ changes: changeSet(), style: "changelog" });
    expect(system).toMatch(/never invent/i);
    expect(system).toMatch(/Keep a Changelog/i);
  });

  it("includes the project, range, totals, and commit subjects in the user prompt", () => {
    const { prompt } = buildPrompt({ changes: changeSet(), style: "blog", project: "my-lib" });
    expect(prompt).toContain("Project: my-lib");
    expect(prompt).toContain("v1.0.0..HEAD");
    expect(prompt).toContain("2 commits");
    expect(prompt).toContain("feat: add export flag");
    expect(prompt).toContain("fix: handle empty input");
    expect(prompt).toContain("Lets users export."); // body included
  });

  it("renders changed files largest-first", () => {
    const { prompt } = buildPrompt({ changes: changeSet(), style: "technical" });
    const cliIdx = prompt.indexOf("src/cli.ts");
    const indexIdx = prompt.indexOf("src/index.ts");
    expect(cliIdx).toBeGreaterThan(-1);
    expect(cliIdx).toBeLessThan(indexIdx); // cli.ts has more churn, listed first
  });

  it("weaves user guidance into the system prompt", () => {
    const { system } = buildPrompt({ changes: changeSet(), style: "blog", guidance: "Mention the new logo." });
    expect(system).toContain("Mention the new logo.");
  });

  it("includes a PR description when provided", () => {
    const { prompt } = buildPrompt({
      changes: changeSet(),
      style: "release-notes",
      title: "Add export",
      description: "This PR adds an export flag.",
    });
    expect(prompt).toContain("Title: Add export");
    expect(prompt).toContain("This PR adds an export flag.");
  });

  it("truncates the commit list to the budget and notes the omission", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      hash: String(i).repeat(40).slice(0, 40),
      short: `c${i}`,
      subject: `commit ${i}`,
      body: "",
      author: "x",
      date: "2026-06-01T00:00:00Z",
    }));
    const { prompt } = buildPrompt({ changes: changeSet({ commits: many }), style: "blog", maxCommits: 3 });
    expect(prompt).toContain("and 7 more commits");
  });

  it("uses the bare ref label when there is no from ref", () => {
    const { prompt } = buildPrompt({ changes: changeSet({ from: "" }), style: "changelog" });
    expect(prompt).toContain("Change range: HEAD");
    expect(prompt).not.toContain("..HEAD");
  });
});
