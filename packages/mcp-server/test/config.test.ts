import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACTED_URL_PARAMETERS,
  DEFAULT_SENSITIVE_DOMAINS,
  evaluateUrlPolicy,
  loadServerConfig,
  persistPairedExtension,
  type ResearchPolicy
} from "../src/config.js";

const token = "a".repeat(64);
const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const defaultPolicy = {
  allowAuthenticatedSources: false,
  captureRetentionCount: 50,
  captureRetentionMs: 0,
  doNotRetain: false,
  domainAllowlist: [],
  domainDenylist: [],
  maxConcurrentFetches: 4,
  maxExtractedChars: 500_000,
  maxPagesPerSession: 50,
  redactedUrlParameters: [...DEFAULT_REDACTED_URL_PARAMETERS],
  sensitiveDomainDenylist: [...DEFAULT_SENSITIVE_DOMAINS]
};

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
      ...defaultPolicy,
      source: path
    });
  });

  it("prefers explicit environment variables", async () => {
    await expect(loadServerConfig({
      BROWSER_RESEARCH_TOKEN: token,
      BROWSER_RESEARCH_EXTENSION_ID: extensionId,
      BROWSER_RESEARCH_PORT: "32191"
    })).resolves.toEqual({ token, extensionId, port: 32191, brokerIdleMs: 600_000, ...defaultPolicy, source: "environment" });
  });

  it("creates private first-run configuration and persists the paired extension", async () => {
    const directory = await mkdtemp(join(tmpdir(), "browser-research-first-run-"));
    const path = join(directory, "nested", "config.json");
    const config = await loadServerConfig({ BROWSER_RESEARCH_CONFIG: path });
    expect(config).toMatchObject({ extensionId: null, port: 32189, source: path });
    expect(config.token).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o077).toBe(0);

    await persistPairedExtension(config, extensionId);
    const saved = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(saved).toMatchObject({ token: config.token, extensionId });
  });

  it("adds the generated credential to a preconfigured policy file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "browser-research-preconfigured-"));
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify({ domainAllowlist: ["example.com"] }), { mode: 0o600 });
    const config = await loadServerConfig({ BROWSER_RESEARCH_CONFIG: path });
    expect(config.token).toMatch(/^[0-9a-f]{64}$/);
    expect(config.domainAllowlist).toEqual(["example.com"]);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ domainAllowlist: ["example.com"], token: config.token });
  });

  it("rejects the documented placeholder and arbitrary long strings", async () => {
    await expect(loadServerConfig({
      BROWSER_RESEARCH_TOKEN: "replace-with-output-from-openssl-rand-hex-32",
      BROWSER_RESEARCH_EXTENSION_ID: extensionId
    })).rejects.toThrow("64-character lowercase hexadecimal token");
  });

  it("loads policy and retention controls from config with environment overrides", async () => {
    const directory = await mkdtemp(join(tmpdir(), "browser-research-policy-"));
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify({
      token,
      extensionId,
      domainAllowlist: ["docs.example.com"],
      domainDenylist: ["blocked.example.com"],
      sensitiveDomainDenylist: [],
      allowAuthenticatedSources: true,
      maxPagesPerSession: 8,
      maxConcurrentFetches: 2,
      maxExtractedChars: 40_000,
      redactedUrlParameters: ["ticket"],
      captureRetentionCount: 12,
      captureRetentionMs: 60_000,
      doNotRetain: false
    }));
    await chmod(path, 0o600);

    await expect(loadServerConfig({
      BROWSER_RESEARCH_CONFIG: path,
      BROWSER_RESEARCH_MAX_PAGES_PER_SESSION: "5",
      BROWSER_RESEARCH_DO_NOT_RETAIN: "true"
    })).resolves.toMatchObject({
      source: path,
      domainAllowlist: ["docs.example.com"],
      domainDenylist: ["blocked.example.com"],
      sensitiveDomainDenylist: [],
      allowAuthenticatedSources: true,
      maxPagesPerSession: 5,
      maxConcurrentFetches: 2,
      maxExtractedChars: 40_000,
      redactedUrlParameters: ["ticket"],
      captureRetentionCount: 12,
      captureRetentionMs: 60_000,
      doNotRetain: true
    });
  });

  it("accepts comma-separated domain policy from the environment", async () => {
    const config = await loadServerConfig({
      BROWSER_RESEARCH_TOKEN: token,
      BROWSER_RESEARCH_EXTENSION_ID: extensionId,
      BROWSER_RESEARCH_DOMAIN_ALLOWLIST: "example.com, *.openai.com",
      BROWSER_RESEARCH_DOMAIN_DENYLIST: "private.example.com"
    });
    expect(config.domainAllowlist).toEqual(["example.com", "openai.com"]);
    expect(config.domainDenylist).toEqual(["private.example.com"]);
  });
});

describe("evaluateUrlPolicy", () => {
  const policy: ResearchPolicy = {
    domainAllowlist: ["example.com"],
    domainDenylist: ["blocked.example.com"],
    sensitiveDomainDenylist: ["vault.example.com"],
    allowAuthenticatedSources: false,
    maxPagesPerSession: 10,
    maxConcurrentFetches: 2,
    maxExtractedChars: 10_000,
    redactedUrlParameters: ["token"]
  };

  it("allows subdomains of an allowlisted domain", () => {
    expect(evaluateUrlPolicy("https://docs.example.com/guide", policy)).toMatchObject({ allowed: true, domain: "docs.example.com" });
  });

  it("gives explicit precedence to deny and sensitive rules", () => {
    expect(evaluateUrlPolicy("https://blocked.example.com/", policy)).toMatchObject({ allowed: false, reason: "denylist" });
    expect(evaluateUrlPolicy("https://vault.example.com/", policy)).toMatchObject({ allowed: false, reason: "sensitive" });
  });

  it("denies non-allowlisted, credential-bearing, and declared authenticated sources clearly", () => {
    expect(evaluateUrlPolicy("https://other.test/", policy)).toMatchObject({ allowed: false, reason: "allowlist" });
    expect(evaluateUrlPolicy("https://user:secret@example.com/", policy)).toMatchObject({ allowed: false, reason: "credentials" });
    expect(evaluateUrlPolicy("https://example.com/", policy, true)).toMatchObject({ allowed: false, reason: "authenticated" });
  });
});
