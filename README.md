```
██████╗  ███████╗ ██████╗   ██████╗  ██████╗  ██████╗   ██████╗  ███████╗ ████████╗
██╔══██╗ ██╔════╝ ██╔══██╗ ██╔═══██╗ ╚════██╗ ██╔══██╗ ██╔═══██╗ ██╔════╝ ╚══██╔══╝
██████╔╝ █████╗   ██████╔╝ ██║   ██║  █████╔╝ ██████╔╝ ██║   ██║ ███████╗    ██║   
██╔══██╗ ██╔══╝   ██╔═══╝  ██║   ██║ ██╔═══╝  ██╔═══╝  ██║   ██║ ╚════██║    ██║   
██║  ██║ ███████╗ ██║      ╚██████╔╝ ███████╗ ██║      ╚██████╔╝ ███████║    ██║   
╚═╝  ╚═╝ ╚══════╝ ╚═╝       ╚═════╝  ╚══════╝ ╚═╝       ╚═════╝  ╚══════╝    ╚═╝   
```

# repo2post

**Turn a git diff, tag range, or pull request into a release blog post, changelog, or launch thread — with one AI call.**

[![npm](https://img.shields.io/npm/v/@vtx-labs/repo2post?color=3182ce)](https://www.npmjs.com/package/@vtx-labs/repo2post)
[![CI](https://github.com/VTX-Labs/repo2post/actions/workflows/ci.yml/badge.svg)](https://github.com/VTX-Labs/repo2post/actions)
[![Docs](https://img.shields.io/badge/docs-API_reference-3182ce)](https://vtx-labs.github.io/repo2post/)
[![License: MIT](https://img.shields.io/badge/License-MIT-3182ce.svg)](LICENSE)

---

You shipped the release. Now you have to write it up — again. **repo2post** reads
what actually changed (commits + diff stats between two refs, or a GitHub PR) and
drafts the write-up in the format you need: a blog post, a Keep-a-Changelog
entry, GitHub release notes, a launch thread, or a technical breakdown. It is
**grounded** — the prompt forbids inventing features that aren't in the diff — and
**model-agnostic**: pass any `provider/model` string and it routes through the
[Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

```console
$ repo2post --from v1.0.0 --to v1.1.0 --style changelog --project envjoy
repo2post changelog from v1.0.0..v1.1.0 (12 commits) via anthropic/claude-sonnet-4.5…

## v1.1.0

### Added
- `--generate` now accepts `--force` to overwrite an existing example (a1b2c3d)

### Fixed
- Inline `#` comments are stripped the way dotenv does (e4f5a6b)
- Duplicate keys now fail `--check` instead of being silently ignored (c7d8e9f)
```

## Quick start

```bash
export AI_GATEWAY_API_KEY=...    # or a provider key, e.g. ANTHROPIC_API_KEY

# Default: previous tag → HEAD, as a blog post
npx @vtx-labs/repo2post

# A specific range as a changelog, written to a file
npx @vtx-labs/repo2post --from v1.0.0 --to v1.1.0 -s changelog -o CHANGELOG-1.1.0.md

# A launch thread from a GitHub pull request
npx @vtx-labs/repo2post --pr VTX-Labs/repo2post#1 -s thread
```

Or add it to a project: `pnpm add -D @vtx-labs/repo2post`

## Styles

| Style           | Output                                                                 |
| :-------------- | :--------------------------------------------------------------------- |
| `blog`          | Narrative release post — headline, intro, themed sections (default)    |
| `changelog`     | Keep a Changelog entry — Added / Changed / Fixed / Removed             |
| `release-notes` | GitHub release notes — highlights + what's changed                     |
| `thread`        | X/Twitter launch thread — numbered, punchy, no hashtag spam            |
| `technical`     | Engineer-facing breakdown — what changed, why, migration notes         |

## CLI

```
repo2post [options]

Source
  --from <ref>           Start ref, exclusive (default: previous tag, else root)
  --to <ref>             End ref, inclusive   (default: HEAD)
  --pr <owner/repo#n>    Use a GitHub pull request instead of a local range
  -C, --cwd <dir>        Repository directory (default: current directory)
  --max-commits <n>      Cap commits read from the range (default: 200)

Output
  -s, --style <style>    blog | changelog | release-notes | thread | technical
  -m, --model <id>       provider/model id (default: anthropic/claude-sonnet-4.5)
  --project <name>       Project name to anchor the writing
  --guidance <text>      Extra instructions to weave into the prompt
  --temperature <n>      Sampling temperature 0–2 (default: 0.4)
  -o, --out <file>       Write to a file instead of stdout

Other
  --list-models          Print the curated model ids and exit
  -h, --help             Show help
  -v, --version          Show version
```

| Exit code | Meaning                                                  |
| :-------- | :------------------------------------------------------- |
| `0`       | Generated successfully                                   |
| `1`       | No commits in the range — nothing to write               |
| `2`       | Usage error, not a git repo, or a bad ref                |
| `3`       | Generation failed (model / API error)                    |
| `4`       | No AI credentials found in the environment               |

The generated content goes to **stdout**; progress and token usage go to
**stderr**, so you can pipe the result straight into a file or `gh`:

```bash
repo2post -s release-notes | gh release create v1.1.0 --notes-file -
```

## Models & credentials

Models are plain `provider/model` strings. In AI SDK 6 such a string routes
through the Vercel AI Gateway automatically, so a single `AI_GATEWAY_API_KEY`
unlocks every major provider. A direct provider key (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY`, …) works too.
Run `repo2post --list-models` for a curated set — but any gateway model id is
accepted.

## Programmatic API

```ts
import { collectChanges, generatePost } from "@vtx-labs/repo2post";

const changes = await collectChanges({ from: "v1.0.0", to: "v1.1.0" });
const post = await generatePost(
  { changes, style: "changelog", project: "my-lib" },
  { model: "anthropic/claude-sonnet-4.5" },
);
console.log(post.content);
```

| Export                            | Description                                                        |
| :-------------------------------- | :----------------------------------------------------------------- |
| `collectChanges(options?)`        | Read a git range (read-only) → `ChangeSet`                         |
| `collectPullRequest(ref, token?)` | Read a GitHub PR via the REST API → `ChangeSet`                    |
| `parsePrRef(input)`               | Parse `owner/repo#123` or a PR URL                                 |
| `buildPrompt(input)`              | Build the grounded system + user prompt for a change set + style   |
| `generatePost(input, options?)`   | Run the AI generation → `{ content, model, usage, … }`             |
| `allStyles()` / `MODELS`          | The available styles and curated models                            |

`generatePost` accepts an injected `generateText` (matching the AI SDK shape),
so you can unit-test the whole pipeline with no network and no API key.

## How it works

1. **Acquire** — read commits + `git diff --numstat` between two refs (read-only),
   or fetch a pull request from the GitHub API. A PR becomes the same `ChangeSet`.
2. **Build a grounded prompt** — serialize the commits and largest file changes,
   truncate to a budget, and pin the rules: write only what the diff supports,
   prefer user-facing impact, never invent versions or numbers.
3. **Generate** — one `generateText` call to the chosen model, via the AI Gateway.
4. **Emit** — content to stdout (or a file); usage + progress to stderr.

> repo2post never writes to your repository and never sends your source code —
> only commit messages and diff statistics are included in the prompt.

## License

[MIT](LICENSE) © [VTX Labs](https://vtxlabs.dev)

<div align="center">
<sub>Built by <a href="https://vtxlabs.dev">VTX Labs</a> · <a href="https://github.com/VTX-Labs">GitHub</a> · <a href="https://x.com/vtxlabs">@vtxlabs</a></sub>
</div>
