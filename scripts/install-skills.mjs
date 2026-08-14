#!/usr/bin/env node
// Installs the generated Claude user-level `/browse` skill into a Claude config
// directory. Targets, in order: --config-dir, then $CLAUDE_CONFIG_DIR, then
// ~/.claude. Run via `pnpm install:skills [-- --config-dir <dir>]`.

import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--config-dir") {
      result.configDir = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configDir = resolve(args.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? resolve(homedir(), ".claude"));
  const source = resolve(ROOT, "integrations/claude/user-skills/browse/SKILL.md");
  const destinationDir = resolve(configDir, "skills", "browse");
  await mkdir(destinationDir, { recursive: true });
  await cp(source, resolve(destinationDir, "SKILL.md"));
  process.stdout.write(`Installed /browse skill → ${resolve(destinationDir, "SKILL.md")}\n`);
  process.stdout.write(`(Target Claude config: ${configDir}. Override with --config-dir <dir>.)\n`);
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
