/**
 * Prompt construction.
 *
 * Turns a {@link ChangeSet} into the system + user messages handed to the
 * model. The change set is serialized compactly and truncated to a budget so a
 * very large range still fits a context window; the system prompt fixes the
 * ground rules (most importantly: never invent changes) and the selected style
 * supplies the shape.
 */

import type { ChangeSet } from "./git.js";
import { getStyle, type StyleName } from "./styles.js";

/** Inputs to {@link buildPrompt}. */
export interface PromptInput {
  changes: ChangeSet;
  style: StyleName;
  /** Optional project name to anchor the writing. */
  project?: string;
  /** Optional extra guidance from the user, woven into the system prompt. */
  guidance?: string;
  /** Optional PR title/description when the source is a pull request. */
  title?: string;
  description?: string;
  /** Soft cap on commits rendered into the prompt. Default 120. */
  maxCommits?: number;
  /** Soft cap on changed-file lines rendered. Default 60. */
  maxFiles?: number;
  /** Include the shaped diff (`changes.diff`) in the prompt. Default true. */
  includeDiff?: boolean;
}

/** The messages to send to the model. */
export interface BuiltPrompt {
  system: string;
  prompt: string;
}

const BASE_RULES = [
  "You are a precise technical writer that turns software change sets into release content.",
  "Ground every statement in the provided commits, file changes, and code diff — never invent features, fixes, numbers, or version names that are not supported by the input.",
  "When the commit messages are vague, rely on the actual diff to infer what changed; describe the behavior the code now has, not what a message guesses at.",
  "If the input is thin, write less rather than padding with speculation.",
  "Prefer the user-facing impact of a change over its implementation detail, unless the chosen style is explicitly technical.",
  "Some files (lockfiles, generated, binary, secrets) are excluded from the diff by design; do not comment on their absence.",
  "Write in clear, plain language. Output only the requested content with no preamble, no meta commentary, and no surrounding code fences.",
].join(" ");

function renderCommits(changes: ChangeSet, max: number): string {
  const shown = changes.commits.slice(0, max);
  const lines = shown.map((commit) => {
    const body = commit.body ? `\n    ${commit.body.replace(/\n/g, "\n    ")}` : "";
    return `- ${commit.short} ${commit.subject}${body}`;
  });
  if (changes.commits.length > max) {
    lines.push(`- …and ${changes.commits.length - max} more commits (omitted to fit the budget).`);
  }
  return lines.join("\n");
}

function renderFiles(changes: ChangeSet, max: number): string {
  if (changes.files.length === 0) return "";
  const sorted = [...changes.files].sort((a, b) => b.insertions + b.deletions - (a.insertions + a.deletions));
  const shown = sorted.slice(0, max);
  const lines = shown.map((f) => `- ${f.path} (+${f.insertions} / -${f.deletions})`);
  if (changes.files.length > max) {
    lines.push(`- …and ${changes.files.length - max} more files.`);
  }
  return lines.join("\n");
}

/** Render the shaped diff as a fenced code block, with an omission footnote. */
function renderDiff(changes: ChangeSet): string {
  const diff = changes.diff;
  if (!diff || diff.files.length === 0) return "";

  const body = diff.files
    .map((f) => `# ${f.path}${f.truncated ? " (truncated)" : ""}\n${f.patch}`)
    .join("\n\n");

  const notes: string[] = [];
  if (diff.omittedForBudget.length > 0) {
    notes.push(`Omitted to fit the size budget: ${diff.omittedForBudget.join(", ")}.`);
  }
  const footnote = notes.length > 0 ? `\n\n${notes.join(" ")}` : "";

  // The diff is fenced so the model treats it as data, not instructions.
  return `Code diff (sensitive/generated/binary files excluded):\n\`\`\`diff\n${body}\n\`\`\`${footnote}`;
}

/** Build the system + user prompt for a change set and style. */
export function buildPrompt(input: PromptInput): BuiltPrompt {
  const { changes, style } = input;
  const maxCommits = input.maxCommits ?? 120;
  const maxFiles = input.maxFiles ?? 60;
  const styleDef = getStyle(style);

  const system = [BASE_RULES, styleDef.instructions, input.guidance?.trim()].filter(Boolean).join("\n\n");

  const header: string[] = [];
  if (input.project) header.push(`Project: ${input.project}`);
  if (input.title) header.push(`Title: ${input.title}`);
  const rangeLabel = changes.from ? `${changes.from}..${changes.to}` : changes.to;
  header.push(`Change range: ${rangeLabel}`);
  header.push(`Totals: ${changes.commits.length} commits, +${changes.insertions} / -${changes.deletions} lines across ${changes.files.length} files.`);

  const sections: string[] = [header.join("\n")];
  if (input.description) sections.push(`Pull request description:\n${input.description}`);
  sections.push(`Commits (newest first):\n${renderCommits(changes, maxCommits)}`);
  const files = renderFiles(changes, maxFiles);
  if (files) sections.push(`Changed files (largest first):\n${files}`);
  if (input.includeDiff !== false) {
    const diff = renderDiff(changes);
    if (diff) sections.push(diff);
  }

  const prompt = [
    `Write the ${styleDef.name} content for the following change set.`,
    sections.join("\n\n"),
  ].join("\n\n");

  return { system, prompt };
}
