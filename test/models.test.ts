import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, isValidModelId, MODELS } from "../src/models.js";

describe("models", () => {
  it("has a default that is also in the curated list", () => {
    expect(MODELS.some((m) => m.id === DEFAULT_MODEL)).toBe(true);
  });

  it("every curated model has the provider/model shape", () => {
    for (const m of MODELS) {
      expect(isValidModelId(m.id)).toBe(true);
      expect(m.label.length).toBeGreaterThan(0);
    }
  });

  it("accepts any well-formed provider/model id", () => {
    expect(isValidModelId("anthropic/claude-sonnet-4.5")).toBe(true);
    expect(isValidModelId("openai/gpt-5")).toBe(true);
    expect(isValidModelId("some-provider/some-model-v2")).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isValidModelId("")).toBe(false);
    expect(isValidModelId("nomodel")).toBe(false);
    expect(isValidModelId("provider/")).toBe(false);
    expect(isValidModelId("/model")).toBe(false);
    expect(isValidModelId("has space/model")).toBe(false);
  });
});
