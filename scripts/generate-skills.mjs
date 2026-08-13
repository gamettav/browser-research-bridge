#!/usr/bin/env node
// Generates every harness artifact for the `browse` command from the single
// canonical definition in skills-src/browse.mjs. Run via `pnpm generate:skills`.
//
// Outputs (all GENERATED — do not hand-edit):
//   integrations/claude/user-skills/browse/SKILL.md   → Claude user-level skill  (/browse, implicit)
//   integrations/claude/br/.claude-plugin/plugin.json  → portable Claude plugin `br`
//   integrations/claude/br/commands/browse.md          → Claude plugin command   (/br:browse)
//   integrations/codex/browser-research/skills/browse/SKILL.md   → Codex skill   ($browse)
//   integrations/codex/browser-research/agents/openai.yaml       → Codex agent metadata

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as browse from "../skills-src/browse.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GEN_MD = "<!-- GENERATED from skills-src/browse.mjs by scripts/generate-skills.mjs. Do not edit; edit the canonical file and run `pnpm generate:skills`. -->";
const GEN_YAML = "# GENERATED from skills-src/browse.mjs by scripts/generate-skills.mjs. Do not edit; edit the canonical file and run `pnpm generate:skills`.";

const WHEN_TO_USE =
  "research this, research X, look this up, look up, find sources on, find out about, " +
  "browse the web, search the web for, check the latest on, what's new with, verify online, " +
  "read this link, summarize this URL, open this page";

function renderBody(harness) {
  const tokens = browse.TOKENS[harness];
  return browse.BODY.replaceAll("{{INVOKE}}", tokens.invoke).replaceAll("{{DEBUG}}", tokens.debug);
}

function claudeUserSkill() {
  const front = [
    "---",
    `name: ${browse.NAME}`,
    `description: ${browse.DESCRIPTION}`,
    `when_to_use: ${WHEN_TO_USE}`,
    `argument-hint: ${browse.ARGUMENT_HINT}`,
    `allowed-tools: ${browse.allowedToolIds.join(" ")}`,
    "---"
  ].join("\n");
  const input = "The user's request (question or URL) is: $ARGUMENTS\n\n";
  return `${front}\n\n${GEN_MD}\n\n${input}${renderBody("claude")}\n`;
}

function claudePluginManifest() {
  return `${JSON.stringify(
    {
      _generated: "from skills-src/browse.mjs by scripts/generate-skills.mjs — do not edit",
      name: "br",
      displayName: "Browser Research — browse",
      version: "0.4.0",
      description: "Portable /br:browse command: research the web through the local Browser Research bridge.",
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
    `description: ${browse.DESCRIPTION}`,
    `argument-hint: ${browse.ARGUMENT_HINT}`,
    `allowed-tools: ${browse.allowedToolIds.join(" ")}`,
    "---"
  ].join("\n");
  const input = "The user's request (question or URL) is: $ARGUMENTS\n\n";
  return `${front}\n\n${GEN_MD}\n\n${input}${renderBody("claude")}\n`;
}

function codexSkill() {
  const front = [
    "---",
    `name: ${browse.NAME}`,
    `description: ${browse.DESCRIPTION}`,
    "---"
  ].join("\n");
  return `${front}\n\n${GEN_MD}\n\n${renderBody("codex")}\n`;
}

function yamlList(items, indent) {
  return items.map((item) => `${indent}- ${item}`).join("\n");
}

function codexAgents() {
  const triggers = [
    "research this topic",
    "look this up",
    "browse the web",
    "search the web for",
    "find sources on",
    "check the latest on",
    "verify this online",
    "read and summarize this URL"
  ];
  return [
    GEN_YAML,
    `name: ${browse.NAME}`,
    `description: "${browse.DESCRIPTION}"`,
    `default_prompt: "${browse.DEFAULT_PROMPT}"`,
    `argument_hint: "${browse.ARGUMENT_HINT}"`,
    `category: ${browse.CATEGORY}`,
    "capabilities:",
    "  - Read",
    "activation:",
    '  explicit: "$browse <question>"',
    "  natural_language:",
    yamlList(triggers.map((trigger) => `"${trigger}"`), "    "),
    "tools:",
    "  mcp:",
    `    server: ${browse.MCP_SERVER}`,
    "    required:",
    yamlList(browse.TOOLS, "      "),
    ""
  ].join("\n");
}

async function emit(relativePath, contents) {
  const target = resolve(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  return relativePath;
}

async function main() {
  // Start each generated tree clean so renames/removals in the canonical file
  // never leave stale artifacts behind.
  await rm(resolve(root, "integrations/claude/user-skills/browse"), { recursive: true, force: true });
  await rm(resolve(root, "integrations/claude/br"), { recursive: true, force: true });
  await rm(resolve(root, "integrations/codex/browser-research/skills/browse"), { recursive: true, force: true });

  const written = [];
  written.push(await emit("integrations/claude/user-skills/browse/SKILL.md", claudeUserSkill()));
  written.push(await emit("integrations/claude/br/.claude-plugin/plugin.json", claudePluginManifest()));
  written.push(await emit("integrations/claude/br/commands/browse.md", claudePluginCommand()));
  written.push(await emit("integrations/codex/browser-research/skills/browse/SKILL.md", codexSkill()));
  written.push(await emit("integrations/codex/browser-research/agents/openai.yaml", codexAgents()));

  process.stdout.write(`Generated ${written.length} browse artifacts from skills-src/browse.mjs:\n`);
  for (const path of written) process.stdout.write(`  - ${path}\n`);
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
