/**
 * Output styles.
 *
 * Each style is a named instruction set that shapes how the model turns a
 * change set into prose. They are deliberately opinionated — a changelog reads
 * nothing like a launch thread — and every one shares the same hard rule: only
 * describe changes that are actually present in the input.
 */

/** The set of supported output styles. */
export type StyleName = "blog" | "changelog" | "release-notes" | "thread" | "technical";

/** A style definition: a label plus the system-prompt fragment that drives it. */
export interface Style {
  name: StyleName;
  /** One-line description shown in `--help` and docs. */
  description: string;
  /** Instructions appended to the system prompt for this style. */
  instructions: string;
}

const STYLES: Record<StyleName, Style> = {
  blog: {
    name: "blog",
    description: "A narrative release blog post with a headline, intro, and themed sections.",
    instructions: [
      "Write a release blog post in Markdown.",
      "Open with a single H1 headline that captures the theme of the release, then a 2-3 sentence intro that frames why this release matters to a reader who hasn't been following along.",
      "Group related changes under H2 section headings; lead each section with the user-facing benefit, then the detail.",
      "Use prose paragraphs, not just bullet lists. Close with a short 'Upgrade' or 'Get started' line if the changes imply one.",
      "Aim for substance over length; do not pad.",
    ].join(" "),
  },
  changelog: {
    name: "changelog",
    description: "A Keep a Changelog style entry grouped by Added / Changed / Fixed / Removed.",
    instructions: [
      "Write a changelog entry in the 'Keep a Changelog' format, in Markdown.",
      "Start with an H2 version heading (use the target ref/version and, if present, the date).",
      "Group entries under the standard subsections in this order, omitting any that are empty: Added, Changed, Deprecated, Removed, Fixed, Security.",
      "Each entry is a single concise bullet describing the change from the user's perspective. Reference the commit short hash in parentheses where it aids traceability.",
      "Do not invent categories or entries.",
    ].join(" "),
  },
  "release-notes": {
    name: "release-notes",
    description: "Concise GitHub release notes with highlights and a full change list.",
    instructions: [
      "Write GitHub release notes in Markdown.",
      "Start with a short '## Highlights' section of 2-5 bullets covering the most significant changes in plain language.",
      "Follow with a \"## What's changed\" section listing the remaining notable changes as bullets.",
      "Keep it scannable and factual; no marketing fluff.",
    ].join(" "),
  },
  thread: {
    name: "thread",
    description: "A launch thread for X/Twitter: numbered posts, punchy, no hashtags spam.",
    instructions: [
      "Write a launch thread for X/Twitter as a numbered list of posts (1/, 2/, ...).",
      "Post 1 is the hook: what shipped and why anyone should care, in under 280 characters.",
      "Each subsequent post covers one concrete change or benefit, conversational and concrete, each under 280 characters.",
      "No hashtag spam (at most one relevant tag if any), no emoji spam (sparing use only).",
      "End with a short call to action.",
    ].join(" "),
  },
  technical: {
    name: "technical",
    description: "A technical breakdown for engineers: what changed, why, and migration notes.",
    instructions: [
      "Write a technical breakdown in Markdown aimed at engineers who will consume these changes.",
      "Use H2 sections such as 'What changed', 'Why', 'Breaking changes', and 'Migration', omitting any that don't apply.",
      "Be precise about APIs, flags, and behavior. Call out anything that requires a code change to adopt.",
      "Prefer accuracy over enthusiasm; if the input doesn't reveal a rationale, describe the change without speculating about intent.",
    ].join(" "),
  },
};

/** All style names, for help text and validation. */
export const STYLE_NAMES = Object.keys(STYLES) as StyleName[];

/** True if `value` is a known style name. */
export function isStyleName(value: string): value is StyleName {
  return value in STYLES;
}

/** Look up a style by name. */
export function getStyle(name: StyleName): Style {
  return STYLES[name];
}

/** All styles, for documentation. */
export function allStyles(): Style[] {
  return STYLE_NAMES.map((n) => STYLES[n]);
}
