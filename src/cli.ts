#!/usr/bin/env node
/**
 * repo2post CLI — turn a git range or pull request into release content.
 *
 * Exit codes:
 *   0  generated successfully
 *   1  nothing to write (no commits in the range)
 *   2  usage error, not a git repo, or a bad ref
 *   3  generation failed (model/API error)
 *   4  missing credentials (no AI gateway / provider key)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { banner } from "./banner.js";
import { c } from "./colors.js";
import { collectChanges, GitError, type ChangeSet } from "./git.js";
import { collectPullRequest, GitHubError, parsePrRef } from "./github.js";
import { generatePost } from "./generate.js";
import { DEFAULT_MODEL, isValidModelId, MODELS } from "./models.js";
import { allStyles, isStyleName, type StyleName } from "./styles.js";

const VERSION = "0.1.0";

interface Flags {
  from?: string;
  to: string;
  pr?: string;
  style: StyleName;
  model: string;
  project?: string;
  guidance?: string;
  cwd: string;
  out?: string;
  maxCommits: number;
  temperature?: number;
  help: boolean;
  version: boolean;
  listModels: boolean;
}

function parseArgs(argv: string[]): Flags {
  const f: Flags = {
    to: "HEAD",
    style: "blog",
    model: DEFAULT_MODEL,
    cwd: process.cwd(),
    maxCommits: 200,
    help: false,
    version: false,
    listModels: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        f.help = true;
        break;
      case "-v":
      case "--version":
        f.version = true;
        break;
      case "--list-models":
        f.listModels = true;
        break;
      case "--from":
        f.from = requireValue(argv, ++i, a);
        break;
      case "--to":
        f.to = requireValue(argv, ++i, a);
        break;
      case "--pr":
        f.pr = requireValue(argv, ++i, a);
        break;
      case "-s":
      case "--style": {
        const v = requireValue(argv, ++i, a);
        if (!isStyleName(v)) fail(`Unknown style: ${v}. Run \`repo2post --help\` to see styles.`);
        f.style = v;
        break;
      }
      case "-m":
      case "--model": {
        const v = requireValue(argv, ++i, a);
        if (!isValidModelId(v)) fail(`Invalid model id: ${v}. Expected "provider/model" (e.g. anthropic/claude-sonnet-4.5).`);
        f.model = v;
        break;
      }
      case "--project":
        f.project = requireValue(argv, ++i, a);
        break;
      case "--guidance":
        f.guidance = requireValue(argv, ++i, a);
        break;
      case "-C":
      case "--cwd":
        f.cwd = resolve(process.cwd(), requireValue(argv, ++i, a));
        break;
      case "-o":
      case "--out":
        f.out = requireValue(argv, ++i, a);
        break;
      case "--max-commits":
        f.maxCommits = parsePositiveInt(requireValue(argv, ++i, a), a);
        break;
      case "--temperature":
        f.temperature = parseTemperature(requireValue(argv, ++i, a));
        break;
      default:
        if (a !== undefined && a.startsWith("-")) fail(`Unknown option: ${a}\nRun \`repo2post --help\` for usage.`);
        else if (a !== undefined) fail(`Unexpected argument: ${a}\nRun \`repo2post --help\` for usage.`);
    }
  }
  return f;
}

function requireValue(argv: string[], i: number, flag: string): string {
  const v = argv[i];
  if (v === undefined || (v.startsWith("-") && v.length > 1 && !/^-?\d/.test(v))) {
    fail(`Option ${flag} expects a value.`);
  }
  return v as string;
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) fail(`Option ${flag} expects a positive integer, got: ${value}`);
  return n;
}

function parseTemperature(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 2) fail(`--temperature expects a number between 0 and 2, got: ${value}`);
  return n;
}

function fail(msg: string): never {
  process.stderr.write(`${c.red("error")} ${msg}\n`);
  process.exit(2);
}

function help(): void {
  const b = c.bold;
  const styleLines = allStyles()
    .map((s) => `      ${b(s.name.padEnd(14))} ${c.dim(s.description)}`)
    .join("\n");
  process.stdout.write(`
${banner("git changes → blog · changelog · release notes · thread · by VTX Labs")}
${b("repo2post")} ${c.dim("v" + VERSION)} — turn a git range or PR into release content

${b("Usage")}
  repo2post [options]                     ${c.dim("# default: prev tag..HEAD as a blog post")}
  repo2post --from v1.0.0 --to v1.1.0 -s changelog
  repo2post --pr vercel/ai#1234 -s release-notes

${b("Source")}
  --from <ref>           Start ref, exclusive ${c.dim("(default: previous tag, else repo root)")}
  --to <ref>             End ref, inclusive   ${c.dim("(default: HEAD)")}
  --pr <owner/repo#n>    Use a GitHub pull request instead of a local range
  -C, --cwd <dir>        Repository directory ${c.dim("(default: current directory)")}
  --max-commits <n>      Cap commits read from the range ${c.dim("(default: 200)")}

${b("Output")}
  -s, --style <style>    One of:
${styleLines}
  -m, --model <id>       provider/model id ${c.dim(`(default: ${DEFAULT_MODEL})`)}
  --project <name>       Project name to anchor the writing
  --guidance <text>      Extra instructions to weave into the prompt
  --temperature <n>      Sampling temperature 0–2 ${c.dim("(default: 0.4)")}
  -o, --out <file>       Write to a file instead of stdout

${b("Other")}
  --list-models          Print the curated model ids and exit
  -h, --help             Show this help
  -v, --version          Show version

${b("Credentials")}
  Set ${b("AI_GATEWAY_API_KEY")} to route any model through the Vercel AI Gateway,
  or a provider key the gateway recognizes (OPENAI_API_KEY, ANTHROPIC_API_KEY, …).

${c.dim("Built by VTX Labs · https://vtxlabs.dev")}
`);
}

function listModels(): void {
  const out = process.stdout;
  out.write(`${c.bold("Curated models")} ${c.dim("(any gateway provider/model id also works)")}\n`);
  for (const m of MODELS) {
    const marker = m.id === DEFAULT_MODEL ? c.green(" (default)") : "";
    out.write(`  ${c.cyan(m.id)}${marker}\n    ${c.dim(m.label)}\n`);
  }
}

/** True if at least one credential the gateway/providers understand is set. */
function hasCredentials(): boolean {
  const keys = [
    "AI_GATEWAY_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "XAI_API_KEY",
    "VERCEL_OIDC_TOKEN",
  ];
  return keys.some((k) => {
    const v = process.env[k];
    return v !== undefined && v !== "";
  });
}

async function acquire(flags: Flags): Promise<ChangeSet & { title?: string; description?: string }> {
  if (flags.pr) {
    const ref = parsePrRef(flags.pr);
    const token = process.env["GITHUB_TOKEN"] || process.env["GH_TOKEN"];
    return collectPullRequest(ref, token);
  }
  return collectChanges({
    cwd: flags.cwd,
    maxCommits: flags.maxCommits,
    ...(flags.from !== undefined ? { from: flags.from } : {}),
    to: flags.to,
  });
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) return help();
  if (flags.version) {
    process.stdout.write(VERSION + "\n");
    return;
  }
  if (flags.listModels) return listModels();

  // Acquire the change set (git range or PR).
  let changes: ChangeSet & { title?: string; description?: string };
  try {
    changes = await acquire(flags);
  } catch (err) {
    if (err instanceof GitError || err instanceof GitHubError) fail(err.message);
    throw err;
  }

  if (changes.commits.length === 0) {
    const range = changes.from ? `${changes.from}..${changes.to}` : changes.to;
    process.stderr.write(`${c.yellow("!")} No commits found in ${range}. Nothing to write.\n`);
    process.exit(1);
  }

  if (!hasCredentials()) {
    process.stderr.write(
      `${c.red("error")} No AI credentials found.\n` +
        `  Set ${c.bold("AI_GATEWAY_API_KEY")} (Vercel AI Gateway) or a provider key like ${c.bold("ANTHROPIC_API_KEY")}.\n`,
    );
    process.exit(4);
  }

  // Progress to stderr so piped stdout stays clean (the content only).
  if (process.stderr.isTTY) {
    const range = changes.from ? `${changes.from}..${changes.to}` : changes.to;
    process.stderr.write(
      `${c.dim("repo2post")} ${c.bold(flags.style)} from ${c.cyan(range)} ` +
        `${c.dim(`(${changes.commits.length} commits)`)} via ${c.cyan(flags.model)}…\n`,
    );
  }

  let post;
  try {
    post = await generatePost(
      {
        changes,
        style: flags.style,
        ...(flags.project !== undefined ? { project: flags.project } : {}),
        ...(flags.guidance !== undefined ? { guidance: flags.guidance } : {}),
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
      },
      {
        model: flags.model,
        ...(flags.temperature !== undefined ? { temperature: flags.temperature } : {}),
      },
    );
  } catch (err) {
    process.stderr.write(`${c.red("error")} Generation failed: ${(err as Error).message}\n`);
    process.exit(3);
  }

  if (flags.out !== undefined) {
    writeFileSync(resolve(process.cwd(), flags.out), post.content + "\n", "utf8");
    process.stderr.write(`${c.green("wrote")} ${flags.out}\n`);
  } else {
    process.stdout.write(post.content + "\n");
  }

  if (process.stderr.isTTY && post.usage) {
    const { inputTokens, outputTokens } = post.usage;
    process.stderr.write(c.dim(`tokens: ${inputTokens ?? "?"} in / ${outputTokens ?? "?"} out\n`));
  }
}

main().catch((err) => {
  process.stderr.write(`${c.red("error")} ${(err as Error).message ?? String(err)}\n`);
  process.exit(2);
});
