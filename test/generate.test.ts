import { describe, expect, it, vi } from "vitest";
import type { ChangeSet } from "../src/git.js";
import { generatePost, type GenerateTextArgs, type GenerateTextFn } from "../src/generate.js";
import { DEFAULT_MODEL } from "../src/models.js";

const changes: ChangeSet = {
  from: "v1.0.0",
  to: "HEAD",
  commits: [{ hash: "a".repeat(40), short: "aaaaaaa", subject: "feat: ship it", body: "", author: "x", date: "2026-06-01T00:00:00Z" }],
  files: [{ path: "src/x.ts", insertions: 10, deletions: 2 }],
  insertions: 10,
  deletions: 2,
};

function fakeModel(text = "## Result\nGenerated.", capture?: (a: GenerateTextArgs) => void): GenerateTextFn {
  return async (args) => {
    capture?.(args);
    return { text, usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 }, finishReason: "stop" };
  };
}

describe("generatePost", () => {
  it("calls the injected generateText and returns trimmed content + metadata", async () => {
    const post = await generatePost(
      { changes, style: "changelog" },
      { generateText: fakeModel("  \n## Changelog\n- a\n  "), model: "openai/gpt-5-mini" },
    );
    expect(post.content).toBe("## Changelog\n- a");
    expect(post.model).toBe("openai/gpt-5-mini");
    expect(post.style).toBe("changelog");
    expect(post.usage).toEqual({ inputTokens: 120, outputTokens: 40, totalTokens: 160 });
    expect(post.finishReason).toBe("stop");
  });

  it("defaults the model when none is given", async () => {
    let seen: GenerateTextArgs | undefined;
    const post = await generatePost({ changes, style: "blog" }, { generateText: fakeModel("x", (a) => (seen = a)) });
    expect(post.model).toBe(DEFAULT_MODEL);
    expect(seen?.model).toBe(DEFAULT_MODEL);
  });

  it("passes temperature and a default maxOutputTokens through", async () => {
    let seen: GenerateTextArgs | undefined;
    await generatePost(
      { changes, style: "blog" },
      { generateText: fakeModel("x", (a) => (seen = a)), temperature: 0.9 },
    );
    expect(seen?.temperature).toBe(0.9);
    expect(seen?.maxOutputTokens).toBeGreaterThan(0);
  });

  it("builds a grounded prompt that carries the commit subjects and style", async () => {
    let seen: GenerateTextArgs | undefined;
    await generatePost(
      { changes, style: "thread", project: "p" },
      { generateText: fakeModel("x", (a) => (seen = a)) },
    );
    expect(seen?.system).toMatch(/never invent/i);
    expect(seen?.system).toMatch(/X\/Twitter/i); // thread style
    expect(seen?.prompt).toContain("feat: ship it");
    expect(seen?.prompt).toContain("Project: p");
  });

  it("forwards an abort signal", async () => {
    let seen: GenerateTextArgs | undefined;
    const controller = new AbortController();
    await generatePost(
      { changes, style: "blog" },
      { generateText: fakeModel("x", (a) => (seen = a)), abortSignal: controller.signal },
    );
    expect(seen?.abortSignal).toBe(controller.signal);
  });

  it("propagates a model error", async () => {
    const boom: GenerateTextFn = vi.fn(async () => {
      throw new Error("model exploded");
    });
    await expect(generatePost({ changes, style: "blog" }, { generateText: boom })).rejects.toThrow("model exploded");
  });

  it("omits usage/finishReason when the model does not return them", async () => {
    const minimal: GenerateTextFn = async () => ({ text: "hi" });
    const post = await generatePost({ changes, style: "blog" }, { generateText: minimal });
    expect(post.content).toBe("hi");
    expect(post.usage).toBeUndefined();
    expect(post.finishReason).toBeUndefined();
  });
});
