import { describe, expect, it } from "vitest";
import { classifyPath, shapeDiff, splitUnifiedDiff } from "../src/diff.js";

const PATCH = `diff --git a/src/cli.ts b/src/cli.ts
index 111..222 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
diff --git a/.env b/.env
index 333..444 100644
--- a/.env
+++ b/.env
@@ -1 +1 @@
-SECRET=old
+SECRET=newvalue
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 555..666 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1 @@
-x
+y
diff --git a/logo.png b/logo.png
index 777..888 100644
Binary files a/logo.png and b/logo.png differ
`;

describe("classifyPath", () => {
  it("flags secrets", () => {
    expect(classifyPath(".env")).toBe("sensitive");
    expect(classifyPath("config/.env.production")).toBe("sensitive");
    expect(classifyPath("certs/server.pem")).toBe("sensitive");
    expect(classifyPath("deploy/id_rsa")).toBe("sensitive");
  });
  it("flags generated/lockfiles/vendored", () => {
    expect(classifyPath("pnpm-lock.yaml")).toBe("generated");
    expect(classifyPath("package-lock.json")).toBe("generated");
    expect(classifyPath("dist/index.js")).toBe("generated");
    expect(classifyPath("node_modules/x/y.js")).toBe("generated");
    expect(classifyPath("app.min.js")).toBe("generated");
  });
  it("flags binaries/assets", () => {
    expect(classifyPath("logo.png")).toBe("binary");
    expect(classifyPath("fonts/Geist.woff2")).toBe("binary");
  });
  it("keeps ordinary source files", () => {
    expect(classifyPath("src/cli.ts")).toBeNull();
    expect(classifyPath("README.md")).toBeNull();
  });
});

describe("splitUnifiedDiff", () => {
  it("splits into per-file sections using the +++ path", () => {
    const sections = splitUnifiedDiff(PATCH);
    expect(sections.map((s) => s.path)).toEqual(["src/cli.ts", ".env", "pnpm-lock.yaml", "logo.png"]);
  });
  it("marks binary sections", () => {
    const sections = splitUnifiedDiff(PATCH);
    expect(sections.find((s) => s.path === "logo.png")?.binary).toBe(true);
  });
  it("returns nothing for an empty patch", () => {
    expect(splitUnifiedDiff("")).toEqual([]);
  });
});

describe("shapeDiff", () => {
  it("keeps source files and skips sensitive/generated/binary ones", () => {
    const shaped = shapeDiff(PATCH);
    expect(shaped.files.map((f) => f.path)).toEqual(["src/cli.ts"]);
    const reasons = Object.fromEntries(shaped.skipped.map((s) => [s.path, s.reason]));
    expect(reasons).toEqual({ ".env": "sensitive", "pnpm-lock.yaml": "generated", "logo.png": "binary" });
  });

  it("never lets a secret value reach the output", () => {
    const shaped = shapeDiff(PATCH);
    const text = JSON.stringify(shaped.files);
    expect(text).not.toContain("newvalue");
    expect(text).not.toContain("SECRET=");
  });

  it("truncates a file's patch to the per-file budget", () => {
    const big = `diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n` +
      Array.from({ length: 50 }, (_, i) => `+line ${i}`).join("\n") + "\n";
    const shaped = shapeDiff(big, { maxLinesPerFile: 10 });
    expect(shaped.files[0]!.truncated).toBe(true);
    expect(shaped.files[0]!.patch).toContain("more diff lines truncated");
    expect(shaped.files[0]!.patch.split("\n").length).toBeLessThanOrEqual(11);
  });

  it("omits files once the total budget is spent", () => {
    const two = `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n` +
      Array.from({ length: 20 }, (_, i) => `+x ${i}`).join("\n") +
      `\ndiff --git a/y.ts b/y.ts\n--- a/y.ts\n+++ b/y.ts\n+y change\n`;
    const shaped = shapeDiff(two, { maxLinesPerFile: 100, maxTotalLines: 5 });
    expect(shaped.files.map((f) => f.path)).toEqual(["x.ts"]);
    expect(shaped.omittedForBudget).toEqual(["y.ts"]);
  });

  it("handles an empty patch", () => {
    const shaped = shapeDiff("");
    expect(shaped.files).toEqual([]);
    expect(shaped.includedLines).toBe(0);
  });
});
