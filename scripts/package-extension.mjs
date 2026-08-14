import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "apps/chrome-extension/dist");
const manifest = JSON.parse(await readFile(resolve(extensionRoot, "manifest.json"), "utf8"));
const artifactsRoot = resolve(root, "artifacts");
const archive = resolve(artifactsRoot, `browser-research-chrome-${manifest.version}.zip`);

await mkdir(artifactsRoot, { recursive: true });
await rm(archive, { force: true });
await run("zip", ["-q", "-r", archive, ".", "-x", "*.map"], { cwd: extensionRoot });
process.stdout.write(`${archive}\n`);
