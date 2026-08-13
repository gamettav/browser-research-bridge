import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src/config.js";

const token = "a".repeat(64);
const extensionId = "abcdefghijklmnopabcdefghijklmnop";

describe("loadServerConfig", () => {
  it("loads an installed plugin's shared config file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "browser-research-config-"));
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify({ token, extensionId, port: 32190 }));
    await chmod(path, 0o600);
    await expect(loadServerConfig({ BROWSER_RESEARCH_CONFIG: path })).resolves.toEqual({
      token,
      extensionId,
      port: 32190,
      brokerIdleMs: 600_000,
      source: path
    });
  });

  it("prefers explicit environment variables", async () => {
    await expect(loadServerConfig({
      BROWSER_RESEARCH_TOKEN: token,
      BROWSER_RESEARCH_EXTENSION_ID: extensionId,
      BROWSER_RESEARCH_PORT: "32191"
    })).resolves.toEqual({ token, extensionId, port: 32191, brokerIdleMs: 600_000, source: "environment" });
  });

  it("fails without leaking secrets when configuration is missing", async () => {
    await expect(loadServerConfig({ BROWSER_RESEARCH_CONFIG: "/definitely/missing/config.json" })).rejects.toThrow(
      "Set BROWSER_RESEARCH_TOKEN"
    );
  });

  it("rejects the documented placeholder and arbitrary long strings", async () => {
    await expect(loadServerConfig({
      BROWSER_RESEARCH_TOKEN: "replace-with-output-from-openssl-rand-hex-32",
      BROWSER_RESEARCH_EXTENSION_ID: extensionId
    })).rejects.toThrow("64-character lowercase hexadecimal token");
  });
});
