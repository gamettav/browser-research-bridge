#!/usr/bin/env node
// Validates the committed browse artifacts against the canonical definition and
// the real harness loader expectations. Run via `pnpm validate:skills`; wired into
// `pnpm check` so malformed command frontmatter fails the build.
//
// Checks: committed == generated (drift + idempotence), no unresolved template
// tokens, Claude frontmatter parses as strict YAML with the expected keys, the
// Codex skill metadata uses the supported schema at the supported location, and
// stale artifacts (old openai.yaml location, the retired web-research skill) are gone.

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ROOT, buildArtifacts } from "./generate-skills.mjs";

const failures = [];
const fail = (message) => failures.push(message);

async function exists(relativePath) {
  try { await stat(resolve(ROOT, relativePath)); return true; } catch { return false; }
}

function frontmatter(content, label) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) { fail(`${label}: missing YAML frontmatter`); return null; }
  try {
    return parseYaml(match[1]);
  } catch (error) {
    fail(`${label}: frontmatter is not valid YAML — ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main() {
  const artifacts = buildArtifacts();

  // 1. Committed files exist and byte-match the canonical output (drift + idempotence).
  const committed = new Map();
  for (const { path, content } of artifacts) {
    let onDisk;
    try {
      onDisk = await readFile(resolve(ROOT, path), "utf8");
    } catch {
      fail(`${path}: expected generated artifact is missing — run \`pnpm generate:skills\``);
      continue;
    }
    committed.set(path, onDisk);
    if (onDisk !== content) fail(`${path}: committed file differs from the canonical output — run \`pnpm generate:skills\``);
    if (onDisk.includes("{{")) fail(`${path}: contains an unresolved template token ({{...}})`);
  }

  // 2. Claude user skill frontmatter must parse and keep its keys (the P0 that broke).
  const userSkill = committed.get("integrations/claude/user-skills/browse/SKILL.md");
  if (userSkill) {
    const fm = frontmatter(userSkill, "claude user skill");
    if (fm) {
      if (fm.name !== "browse") fail("claude user skill: name must be 'browse'");
      if (typeof fm.description !== "string" || !fm.description) fail("claude user skill: missing description");
      if (typeof fm["argument-hint"] !== "string") fail("claude user skill: argument-hint did not survive YAML parse (must be quoted)");
      if (typeof fm["allowed-tools"] !== "string" || !fm["allowed-tools"].includes("mcp__browser-research__")) {
        fail("claude user skill: allowed-tools missing or lost the MCP tool grants");
      }
    }
  }

  // 3. Claude plugin command frontmatter + manifest.
  const command = committed.get("integrations/claude/br/commands/browse.md");
  if (command) {
    const fm = frontmatter(command, "claude plugin command");
    if (fm) {
      if (typeof fm["argument-hint"] !== "string") fail("claude plugin command: argument-hint did not survive YAML parse (must be quoted)");
      if (typeof fm["allowed-tools"] !== "string" || !fm["allowed-tools"].includes("mcp__browser-research__")) {
        fail("claude plugin command: allowed-tools missing or lost the MCP tool grants");
      }
    }
  }
  const manifestRaw = committed.get("integrations/claude/br/.claude-plugin/plugin.json");
  if (manifestRaw) {
    try {
      const manifest = JSON.parse(manifestRaw);
      if (manifest.name !== "br") fail("claude plugin manifest: name must be 'br' so the command is /br:browse");
      if ("_generated" in manifest) fail("claude plugin manifest: unsupported '_generated' key must be removed");
    } catch (error) {
      fail(`claude plugin manifest: invalid JSON — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 4. Codex skill frontmatter.
  const codexSkill = committed.get("integrations/codex/browser-research/skills/browse/SKILL.md");
  if (codexSkill) {
    const fm = frontmatter(codexSkill, "codex skill");
    if (fm && fm.name !== "browse") fail("codex skill: name must be 'browse'");
  }

  // 5. Codex UI metadata: supported schema at the supported (skill-scoped) location.
  const openaiPath = "integrations/codex/browser-research/skills/browse/agents/openai.yaml";
  const openaiRaw = committed.get(openaiPath);
  if (openaiRaw) {
    let doc;
    try { doc = parseYaml(openaiRaw); } catch (error) {
      fail(`codex openai.yaml: invalid YAML — ${error instanceof Error ? error.message : String(error)}`);
    }
    if (doc) {
      if (!doc.interface?.display_name) fail("codex openai.yaml: interface.display_name missing");
      if (!doc.interface?.short_description) fail("codex openai.yaml: interface.short_description missing");
      if (!doc.interface?.default_prompt) fail("codex openai.yaml: interface.default_prompt missing");
      const tool = doc.dependencies?.tools?.[0];
      if (!tool || tool.type !== "mcp" || tool.value !== "browser-research") {
        fail("codex openai.yaml: dependencies.tools must declare the browser-research MCP dependency");
      }
      if (doc.policy?.allow_implicit_invocation !== true) fail("codex openai.yaml: policy.allow_implicit_invocation must be true");
      for (const unsupported of ["name", "description", "activation", "tools"]) {
        if (unsupported in doc) fail(`codex openai.yaml: unsupported top-level '${unsupported}' key must be removed`);
      }
    }
  }

  // 6. Stale artifacts must be gone.
  const stale = [
    "integrations/codex/browser-research/agents/openai.yaml",
    "integrations/claude/browser-research/skills/web-research",
    "integrations/codex/browser-research/skills/web-research"
  ];
  for (const path of stale) {
    if (await exists(path)) fail(`stale artifact still present (should be removed): ${path}`);
  }

  if (failures.length > 0) {
    process.stderr.write(`Skill artifact validation failed (${failures.length}):\n`);
    for (const message of failures) process.stderr.write(`  ✗ ${message}\n`);
    process.exit(1);
  }
  process.stdout.write(`Skill artifacts valid: ${artifacts.length} files match the canonical definition and load cleanly.\n`);
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
