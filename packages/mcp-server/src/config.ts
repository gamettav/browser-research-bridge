import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_PORT, isValidBridgeToken, safeDomain } from "@groundtab/protocol";

export const DEFAULT_SENSITIVE_DOMAINS = [
  "account.proton.me",
  "admin.google.com",
  "admin.microsoft.com",
  "mail.google.com",
  "mail.proton.me",
  "my.1password.com",
  "outlook.live.com",
  "outlook.office.com",
  "vault.bitwarden.com"
] as const;

export const DEFAULT_REDACTED_URL_PARAMETERS = [
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "code",
  "credential",
  "jwt",
  "key",
  "password",
  "secret",
  "session",
  "sessionid",
  "signature",
  "state",
  "token"
] as const;

export type ResearchPolicy = {
  domainAllowlist: string[];
  domainDenylist: string[];
  sensitiveDomainDenylist: string[];
  allowAuthenticatedSources: boolean;
  maxPagesPerSession: number;
  maxConcurrentFetches: number;
  maxExtractedChars: number;
  redactedUrlParameters: string[];
};

export type CaptureRetentionConfig = {
  captureRetentionCount: number;
  captureRetentionMs: number;
  doNotRetain: boolean;
};

export type ServerConfig = ResearchPolicy & CaptureRetentionConfig & {
  token: string;
  extensionId: string | null;
  port: number;
  brokerIdleMs: number;
  source: "environment" | string;
};

type ConfigFile = {
  token?: unknown;
  extensionId?: unknown;
  port?: unknown;
  brokerIdleMs?: unknown;
  domainAllowlist?: unknown;
  domainDenylist?: unknown;
  sensitiveDomainDenylist?: unknown;
  allowAuthenticatedSources?: unknown;
  maxPagesPerSession?: unknown;
  maxConcurrentFetches?: unknown;
  maxExtractedChars?: unknown;
  redactedUrlParameters?: unknown;
  captureRetentionCount?: unknown;
  captureRetentionMs?: unknown;
  doNotRetain?: unknown;
};

export type UrlPolicyDecision =
  | { allowed: true; domain: string }
  | { allowed: false; domain: string | null; reason: "credentials" | "allowlist" | "denylist" | "sensitive" | "authenticated"; message: string };

export async function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): Promise<ServerConfig> {
  const configPath = environment.GROUNDTAB_CONFIG ?? defaultConfigPath(environment);
  const needsFile = Boolean(environment.GROUNDTAB_CONFIG) || !environment.GROUNDTAB_TOKEN || !environment.GROUNDTAB_EXTENSION_ID;
  let file = needsFile ? await readConfigFile(configPath) : {};
  let token = environment.GROUNDTAB_TOKEN ?? stringValue(file.token);
  if (token === undefined) {
    await createInitialConfigFile(configPath);
    file = await readConfigFile(configPath);
    token = stringValue(file.token);
  }
  const extensionId = environment.GROUNDTAB_EXTENSION_ID ?? stringValue(file.extensionId) ?? null;
  const port = integerSetting(environment.GROUNDTAB_PORT ?? file.port ?? DEFAULT_PORT, "GROUNDTAB_PORT/config port", 1024, 65535);
  const brokerIdleMs = integerSetting(
    environment.GROUNDTAB_BROKER_IDLE_MS ?? file.brokerIdleMs ?? 10 * 60_000,
    "GROUNDTAB_BROKER_IDLE_MS/config brokerIdleMs",
    1_000,
    24 * 60 * 60_000
  );

  if (!isValidBridgeToken(token)) {
    throw new Error(`GroundTab could not load a valid 64-character lowercase hexadecimal token from ${configPath}`);
  }
  if (extensionId !== null && !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(`The GroundTab extension ID in ${configPath} is invalid`);
  }

  const domainAllowlist = domainListSetting(
    environment.GROUNDTAB_DOMAIN_ALLOWLIST ?? file.domainAllowlist ?? [],
    "GROUNDTAB_DOMAIN_ALLOWLIST/config domainAllowlist"
  );
  const domainDenylist = domainListSetting(
    environment.GROUNDTAB_DOMAIN_DENYLIST ?? file.domainDenylist ?? [],
    "GROUNDTAB_DOMAIN_DENYLIST/config domainDenylist"
  );
  const sensitiveDomainDenylist = domainListSetting(
    environment.GROUNDTAB_SENSITIVE_DOMAIN_DENYLIST ?? file.sensitiveDomainDenylist ?? DEFAULT_SENSITIVE_DOMAINS,
    "GROUNDTAB_SENSITIVE_DOMAIN_DENYLIST/config sensitiveDomainDenylist"
  );
  const allowAuthenticatedSources = booleanSetting(
    environment.GROUNDTAB_ALLOW_AUTHENTICATED_SOURCES ?? file.allowAuthenticatedSources ?? false,
    "GROUNDTAB_ALLOW_AUTHENTICATED_SOURCES/config allowAuthenticatedSources"
  );
  const maxPagesPerSession = integerSetting(
    environment.GROUNDTAB_MAX_PAGES_PER_SESSION ?? file.maxPagesPerSession ?? 50,
    "GROUNDTAB_MAX_PAGES_PER_SESSION/config maxPagesPerSession",
    1,
    10_000
  );
  const maxConcurrentFetches = integerSetting(
    environment.GROUNDTAB_MAX_CONCURRENT_FETCHES ?? file.maxConcurrentFetches ?? 4,
    "GROUNDTAB_MAX_CONCURRENT_FETCHES/config maxConcurrentFetches",
    1,
    100
  );
  const maxExtractedChars = integerSetting(
    environment.GROUNDTAB_MAX_EXTRACTED_CHARS ?? file.maxExtractedChars ?? 500_000,
    "GROUNDTAB_MAX_EXTRACTED_CHARS/config maxExtractedChars",
    1_000,
    500_000
  );
  const redactedUrlParameters = parameterListSetting(
    environment.GROUNDTAB_REDACT_URL_PARAMETERS ?? file.redactedUrlParameters ?? DEFAULT_REDACTED_URL_PARAMETERS,
    "GROUNDTAB_REDACT_URL_PARAMETERS/config redactedUrlParameters"
  );
  const captureRetentionCount = integerSetting(
    environment.GROUNDTAB_CAPTURE_RETENTION_COUNT ?? file.captureRetentionCount ?? 50,
    "GROUNDTAB_CAPTURE_RETENTION_COUNT/config captureRetentionCount",
    0,
    10_000
  );
  const captureRetentionMs = integerSetting(
    environment.GROUNDTAB_CAPTURE_RETENTION_MS ?? file.captureRetentionMs ?? 0,
    "GROUNDTAB_CAPTURE_RETENTION_MS/config captureRetentionMs",
    0,
    30 * 24 * 60 * 60_000
  );
  const doNotRetain = booleanSetting(
    environment.GROUNDTAB_DO_NOT_RETAIN ?? file.doNotRetain ?? false,
    "GROUNDTAB_DO_NOT_RETAIN/config doNotRetain"
  ) || captureRetentionCount === 0;

  return {
    token,
    extensionId,
    port,
    brokerIdleMs,
    domainAllowlist,
    domainDenylist,
    sensitiveDomainDenylist,
    allowAuthenticatedSources,
    maxPagesPerSession,
    maxConcurrentFetches,
    maxExtractedChars,
    redactedUrlParameters,
    captureRetentionCount,
    captureRetentionMs,
    doNotRetain,
    source: needsFile ? configPath : "environment"
  };
}

export async function persistPairedExtension(config: ServerConfig, extensionId: string): Promise<void> {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("Cannot persist an invalid GroundTab extension ID");
  if (config.source === "environment") {
    throw new Error("Pairing is unavailable when all bridge settings come only from environment variables");
  }

  const existing = await readConfigFile(config.source);
  const next = { ...existing, token: config.token, extensionId, port: config.port, brokerIdleMs: config.brokerIdleMs };
  await writePrivateJsonAtomically(config.source, next);
  config.extensionId = extensionId;
}

export function evaluateUrlPolicy(value: string, policy: ResearchPolicy, authenticatedSource = false): UrlPolicyDecision {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { allowed: false, domain: null, reason: "denylist", message: "Research policy denied an invalid URL" };
  }
  const domain = safeDomain(value);
  if (!domain) return { allowed: false, domain: null, reason: "denylist", message: "Research policy could not determine the URL domain" };
  if (url.username || url.password) {
    return { allowed: false, domain, reason: "credentials", message: `Research policy denied ${domain}: URLs containing credentials are not allowed` };
  }
  if (authenticatedSource && !policy.allowAuthenticatedSources) {
    return {
      allowed: false,
      domain,
      reason: "authenticated",
      message: `Research policy denied ${domain}: authenticated browser-session sources are disabled`
    };
  }
  if (matchesDomainList(domain, policy.domainDenylist)) {
    return { allowed: false, domain, reason: "denylist", message: `Research policy denied ${domain}: the domain is on the configured denylist` };
  }
  if (policy.domainAllowlist.length > 0 && !matchesDomainList(domain, policy.domainAllowlist)) {
    return { allowed: false, domain, reason: "allowlist", message: `Research policy denied ${domain}: the domain is not on the configured allowlist` };
  }
  if (matchesDomainList(domain, policy.sensitiveDomainDenylist)) {
    return {
      allowed: false,
      domain,
      reason: "sensitive",
      message: `Research policy denied ${domain}: the domain is classified as a sensitive authenticated surface`
    };
  }
  return { allowed: true, domain };
}

export function matchesDomainList(domain: string, configuredDomains: readonly string[]): boolean {
  const normalized = domain.toLowerCase().replace(/\.$/, "");
  return configuredDomains.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}

export function defaultConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  const configRoot = environment.XDG_CONFIG_HOME || join(environment.HOME || homedir(), ".config");
  return join(configRoot, "groundtab", "config.json");
}

async function readConfigFile(path: string): Promise<ConfigFile> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw new Error(`Could not read GroundTab config at ${path}: ${errorMessage(error)}`);
  }

  try {
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("expected a JSON object");
    await warnIfBroadlyReadable(path);
    return parsed as ConfigFile;
  } catch (error) {
    throw new Error(`Invalid GroundTab config at ${path}: ${errorMessage(error)}`);
  }
}

async function createInitialConfigFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, `${JSON.stringify({ token: randomBytes(32).toString("hex") }, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      const existing = await readConfigFile(path);
      if (existing.token === undefined) {
        await writePrivateJsonAtomically(path, { ...existing, token: randomBytes(32).toString("hex") });
      }
      return;
    }
    throw new Error(`Could not create GroundTab configuration at ${path}: ${errorMessage(error)}`);
  }
}

async function writePrivateJsonAtomically(path: string, value: object): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.config-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    throw new Error(`Could not save GroundTab pairing at ${path}: ${errorMessage(error)}`);
  }
}

async function warnIfBroadlyReadable(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const details = await stat(path);
  if ((details.mode & 0o077) !== 0) {
    process.stderr.write(`Warning: ${path} contains a bridge token and should be readable only by its owner (chmod 600).\n`);
  }
}

function domainListSetting(value: unknown, name: string): string[] {
  return listSetting(value, name).map((entry) => {
    const normalized = entry.toLowerCase().replace(/^\*\./, "").replace(/^\./, "").replace(/\.$/, "");
    if (!normalized || normalized.includes("/") || normalized.includes(":") || safeDomain(`https://${normalized}`) !== normalized) {
      throw new Error(`${name} must contain only valid bare domain names`);
    }
    return normalized;
  }).filter((entry, index, all) => all.indexOf(entry) === index);
}

function parameterListSetting(value: unknown, name: string): string[] {
  return listSetting(value, name).map((entry) => {
    const normalized = entry.toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(normalized)) throw new Error(`${name} contains an invalid parameter name`);
    return normalized;
  }).filter((entry, index, all) => all.indexOf(entry) === index);
}

function listSetting(value: unknown, name: string): string[] {
  const entries = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
    throw new Error(`${name} must be a JSON string array or comma-separated environment value`);
  }
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

function integerSetting(value: unknown, name: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function booleanSetting(value: unknown, name: string): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  throw new Error(`${name} must be true or false`);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
