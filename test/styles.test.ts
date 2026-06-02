import { describe, expect, it } from "vitest";
import { allStyles, getStyle, isStyleName, STYLE_NAMES } from "../src/styles.js";

describe("styles", () => {
  it("exposes the expected set of styles", () => {
    expect(STYLE_NAMES).toEqual(["blog", "changelog", "release-notes", "thread", "technical"]);
  });

  it("isStyleName narrows known names", () => {
    expect(isStyleName("blog")).toBe(true);
    expect(isStyleName("changelog")).toBe(true);
    expect(isStyleName("nope")).toBe(false);
  });

  it("every style has a non-empty description and instructions", () => {
    for (const style of allStyles()) {
      expect(style.description.length).toBeGreaterThan(0);
      expect(style.instructions.length).toBeGreaterThan(0);
      expect(style.name).toBe(style.name); // name matches its key
      expect(getStyle(style.name)).toBe(style);
    }
  });

  it("the thread style mentions the per-post character constraint", () => {
    expect(getStyle("thread").instructions).toMatch(/280 characters/);
  });
});
