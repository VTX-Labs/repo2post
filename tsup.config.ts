import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  target: "node18",
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  // `ai` stays external — it is a runtime dependency, not bundled.
  external: ["ai"],
  // The shebang is preserved from the top of src/cli.ts so `dist/cli.js`
  // is directly executable as the `repo2post` bin.
});
