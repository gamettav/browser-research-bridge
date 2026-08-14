#!/usr/bin/env node
// Generates every harness artifact for the `browse` command from the single
// canonical definition in skills-src/browse.mjs. Run via `pnpm generate:skills`.
//
// Outputs (all GENERATED — do not hand-edit):
//   integrations/claude/user-skills/browse/SKILL.md              Claude user skill  (/browse, implicit)
//   integrations/claude/gt/.claude-plugin/plugin.json            portable Claude plugin `gt`
//   integrations/claude/gt/commands/browse.md                    Claude plugin command  (/gt:browse)
//   integrations/codex/groundtab/skills/browse/SKILL.md          Codex skill  ($browse)
//   integrations/codex/groundtab/skills/browse/agents/openai.yaml  Codex skill UI metadata
//
// `buildArtifacts()` is exported (pure, no fs) so scripts/validate-skills.mjs can
// assert the committed files match what the canonical definition produces.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as browse from "../skills-src/browse.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const GEN_MD = "<!-- GENERATED from skills-src/browse.mjs by scripts/generate-skills.mjs. Do not edit; edit the canonical file and run `pnpm generate:skills`. -->";
const GEN_YAML = "# GENERATED from skills-src/browse.mjs by scripts/generate-skills.mjs. Do not edit; edit the canonical file and run `pnpm generate:skills`.";

const WHEN_TO_USE =
  "research this, research X, look this up, look up, find sources on, find out about, " +
  "browse the web, search the web for, check the latest on, what's new with, verify online, " +
  "read this link, summarize this URL, open this page";

const SHORT_DESCRIPTION = "Research the web and answer with cited sources, through the local Chrome bridge.";
const TOOL_DEPENDENCY_NOTE = "Read-only GroundTab tools: web search and rendered-page fetch.";

// Directories fully owned by the generator; wiped before each run so renames and
// relocations never leave stale artifacts behind (includes the old openai.yaml
// location under the plugin root).
const OWNED_DIRS = [
  "integrations/claude/user-skills/browse",
  "integrations/claude/gt",
  "integrations/codex/groundtab/skills/browse",
  "integrations/codex/groundtab/agents"
];

// Double-quote a scalar so it is always valid YAML regardless of its content
// (leading `[`, colons, etc.). JSON string syntax is a valid YAML flow scalar.
function y(value) {
  return JSON.stringify(String(value));
}

function renderBody(harness) {
  return browse.BODY.replaceAll("{{INVOKE}}", browse.TOKENS[harness].invoke);
}

function claudeUserSkill() {
  const front = [
    "---",
    `name: ${browse.NAME}`,
    `description: ${y(browse.DESCRIPTION)}`,
    `when_to_use: ${y(WHEN_TO_USE)}`,
    `argument-hint: ${y(browse.ARGUMENT_HINT)}`,
    `allowed-tools: ${y(browse.allowedToolIds.join(" "))}`,
    "---"
  ].join("\n");
  const input = "The user's request (question or URL) is: $ARGUMENTS\n\n";
  return `${front}\n\n${GEN_MD}\n\n${input}${renderBody("claude")}\n`;
}

function claudePluginManifest() {
  return `${JSON.stringify(
    {
      name: "gt",
      displayName: "GroundTab — browse",
      version: "0.4.2",
      description: "Portable /gt:browse command: research the web through the local GroundTab bridge.",
      author: { name: "Local developer" },
      keywords: ["research", "browse", "web", "mcp"]
    },
    null,
    2
  )}\n`;
}

function claudePluginCommand() {
  const front = [
    "---",
    `description: ${y(browse.DESCRIPTION)}`,
    `argument-hint: ${y(browse.ARGUMENT_HINT)}`,
    `allowed-tools: ${y(browse.allowedToolIds.join(" "))}`,
    "---"
  ].join("\n");
  const input = "The user's request (question or URL) is: $ARGUMENTS\n\n";
  return `${front}\n\n${GEN_MD}\n\n${input}${renderBody("claude")}\n`;
}

function codexSkill() {
  const front = [
    "---",
    `name: ${browse.NAME}`,
    `description: ${y(browse.DESCRIPTION)}`,
    "---"
  ].join("\n");
  return `${front}\n\n${GEN_MD}\n\n${renderBody("codex")}\n`;
}

function codexAgents() {
  return [
    GEN_YAML,
    "interface:",
    `  display_name: ${y("Browse")}`,
    `  short_description: ${y(SHORT_DESCRIPTION)}`,
    `  default_prompt: ${y(browse.DEFAULT_PROMPT)}`,
    "dependencies:",
    "  tools:",
    "    - type: mcp",
    `      value: ${browse.MCP_SERVER}`,
    `      description: ${y(TOOL_DEPENDENCY_NOTE)}`,
    "policy:",
    "  allow_implicit_invocation: true",
    ""
  ].join("\n");
}

// Pure: the full set of generated artifacts as { path, content }.
export function buildArtifacts() {
  return [
    { path: "integrations/claude/user-skills/browse/SKILL.md", content: claudeUserSkill() },
    { path: "integrations/claude/gt/.claude-plugin/plugin.json", content: claudePluginManifest() },
    { path: "integrations/claude/gt/commands/browse.md", content: claudePluginCommand() },
    { path: "integrations/codex/groundtab/skills/browse/SKILL.md", content: codexSkill() },
    { path: "integrations/codex/groundtab/skills/browse/agents/openai.yaml", content: codexAgents() }
  ];
}

async function main() {
  for (const dir of OWNED_DIRS) await rm(resolve(ROOT, dir), { recursive: true, force: true });
  const artifacts = buildArtifacts();
  for (const { path, content } of artifacts) {
    const target = resolve(ROOT, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  process.stdout.write(`Generated ${artifacts.length} browse artifacts from skills-src/browse.mjs:\n`);
  for (const { path } of artifacts) process.stdout.write(`  - ${path}\n`);
}

// Only write files when run directly, not when imported by the validator.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
