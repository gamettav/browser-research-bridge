import { z } from "zod";

export const DEFAULT_PORT = 32189;
export const PROTOCOL_VERSION = 3;
export const BRIDGE_VERSION = "0.4.1";
export const BRIDGE_BUILD_ID = "browser-research-0.4.1-pairing-v3";
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const PROOF_PATTERN = /^[0-9a-f]{64}$/;
export const NONCE_PATTERN = /^[0-9a-f]{64}$/;
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
export const PAIRING_CODE_PATTERN = /^[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/;

export const AuthChannelSchema = z.enum(["extension", "broker-client"]);

// Extension connections announce whether they already hold a credential. A
// fresh Web Store install can then enter the bounded pairing flow instead of
// requiring a Native Messaging host or a manually pasted long-lived token.
export const ExtensionHelloSchema = z.object({
  type: z.literal("extension_hello"),
  extensionId: z.string().regex(EXTENSION_ID_PATTERN),
  hasToken: z.boolean(),
  clientVersion: z.string().min(1),
  clientBuildId: z.string().min(1)
});

export const PairingRequiredSchema = z.object({
  type: z.literal("pairing_required"),
  nonce: z.string().regex(NONCE_PATTERN),
  protocolVersion: z.number().int().nonnegative(),
  port: z.number().int().min(1024).max(65535),
  expiresAt: z.string().datetime()
});

export const PairingSubmitSchema = z.object({
  type: z.literal("pairing_submit"),
  nonce: z.string().regex(NONCE_PATTERN),
  proof: z.string().regex(PROOF_PATTERN)
});

export const PairingOkSchema = z.object({
  type: z.literal("pairing_ok"),
  nonce: z.string().regex(NONCE_PATTERN),
  token: z.string().regex(TOKEN_PATTERN),
  port: z.number().int().min(1024).max(65535),
  proof: z.string().regex(PROOF_PATTERN)
});

export const PairingErrorSchema = z.object({
  type: z.literal("pairing_error"),
  code: z.enum(["invalid_code", "expired", "locked", "pairing_unavailable"]),
  message: z.string().min(1),
  attemptsRemaining: z.number().int().nonnegative().nullable()
});

export const AuthChallengeSchema = z.object({
  type: z.literal("auth_challenge"),
  channel: AuthChannelSchema,
  nonce: z.string().regex(NONCE_PATTERN),
  protocolVersion: z.number().int().nonnegative(),
  serverVersion: z.string().min(1),
  serverBuildId: z.string().min(1),
  proof: z.string().regex(PROOF_PATTERN)
});

export const AuthResponseSchema = z.object({
  type: z.literal("auth_response"),
  channel: AuthChannelSchema,
  nonce: z.string().regex(NONCE_PATTERN),
  protocolVersion: z.number().int().nonnegative(),
  clientId: z.string().min(1).max(200),
  clientVersion: z.string().min(1),
  clientBuildId: z.string().min(1),
  proof: z.string().regex(PROOF_PATTERN)
});

export const AuthOkSchema = z.object({
  type: z.literal("auth_ok"),
  channel: AuthChannelSchema,
  protocolVersion: z.number().int().nonnegative(),
  serverVersion: z.string().min(1),
  serverBuildId: z.string().min(1)
});

export const ProtocolErrorSchema = z.object({
  type: z.literal("protocol_error"),
  code: z.string().min(1),
  message: z.string().min(1)
});

export const HeartbeatMessageSchema = z.object({
  type: z.literal("heartbeat"),
  at: z.number().int().nonnegative()
});

export const HeartbeatAckSchema = z.object({
  type: z.literal("heartbeat_ack"),
  at: z.number().int().nonnegative()
});

export const RenderedFetchJobSchema = z.object({
  kind: z.literal("fetch_rendered_page"),
  url: z.string().url(),
  timeoutMs: z.number().int().min(5_000).max(120_000),
  maxChars: z.number().int().min(1_000).max(500_000)
});

export const SearchJobSchema = z.object({
  kind: z.literal("search_web"),
  query: z.string().min(1).max(500),
  provider: z.enum(["duckduckgo", "bing", "google"]),
  limit: z.number().int().min(1).max(20),
  timeoutMs: z.number().int().min(5_000).max(120_000)
});

export const BrowserJobSchema = z.discriminatedUnion("kind", [
  RenderedFetchJobSchema,
  SearchJobSchema
]);

export const JobMessageSchema = z.object({
  type: z.literal("job"),
  id: z.string().uuid(),
  deadlineAt: z.number().int().positive(),
  job: BrowserJobSchema
});

export const NavigationCheckMessageSchema = z.object({
  type: z.literal("navigation_check"),
  id: z.string().uuid(),
  url: z.string().url()
});

export const NavigationCheckResultSchema = z.discriminatedUnion("ok", [
  z.object({ type: z.literal("navigation_check_result"), id: z.string().uuid(), ok: z.literal(true) }),
  z.object({
    type: z.literal("navigation_check_result"),
    id: z.string().uuid(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() })
  })
]);

export const PageLinkSchema = z.object({
  text: z.string(),
  url: z.string().url()
});

export const ChallengeKindSchema = z.enum(["captcha", "login", "denied"]).nullable();
export type ChallengeKind = z.infer<typeof ChallengeKindSchema>;

export const PageExtractionSchema = z.object({
  kind: z.literal("page"),
  requestedUrl: z.string().url(),
  finalUrl: z.string().url(),
  canonicalUrl: z.string().url().nullable(),
  title: z.string(),
  siteName: z.string().nullable(),
  byline: z.string().nullable(),
  excerpt: z.string().nullable(),
  language: z.string().nullable(),
  markdown: z.string(),
  textLength: z.number().int().nonnegative(),
  links: z.array(PageLinkSchema),
  capturedAt: z.string().datetime(),
  challenge: z.boolean(),
  challengeKind: ChallengeKindSchema.default(null)
});

export const SearchResultSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string()
});

export const SearchExtractionSchema = z.object({
  kind: z.literal("search"),
  query: z.string(),
  provider: z.enum(["duckduckgo", "bing", "google"]),
  finalUrl: z.string().url(),
  results: z.array(SearchResultSchema),
  capturedAt: z.string().datetime(),
  challenge: z.boolean(),
  challengeKind: ChallengeKindSchema.default(null)
});

// --- Research progress events -------------------------------------------------
// A research session groups the jobs run for one browse request. Progress events
// stream a job's lifecycle up to the harness; they carry domain-only metadata and
// never a full URL, path, or query string.

export const RESEARCH_PHASES = [
  "queued",
  "searching",
  "navigating",
  "rendering",
  "extracting",
  "completed",
  "skipped",
  "failed"
] as const;
export const ResearchPhaseSchema = z.enum(RESEARCH_PHASES);
export type ResearchPhase = z.infer<typeof ResearchPhaseSchema>;

export const TERMINAL_PHASES: readonly ResearchPhase[] = ["completed", "skipped", "failed"];
export function isTerminalPhase(phase: ResearchPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

export const RESEARCH_ERROR_CODES = [
  "not_connected",
  "blocked_url",
  "blocked_redirect",
  "blocked_captcha",
  "requires_login",
  "access_denied",
  "timeout",
  "navigation_changed",
  "tab_failed",
  "extraction_failed",
  "job_expired",
  "bridge_error"
] as const;
export const ResearchErrorCodeSchema = z.enum(RESEARCH_ERROR_CODES);
export type ResearchErrorCode = z.infer<typeof ResearchErrorCodeSchema>;

// Blocked/recoverable codes mean "this source is skipped; try an alternative".
// Everything else is a hard failure.
const SKIP_ERROR_CODES = new Set<ResearchErrorCode>([
  "blocked_url",
  "blocked_redirect",
  "blocked_captcha",
  "requires_login",
  "access_denied"
]);
export function isSkippableErrorCode(code: ResearchErrorCode): boolean {
  return SKIP_ERROR_CODES.has(code);
}
export function terminalPhaseForError(code: ResearchErrorCode): "skipped" | "failed" {
  return SKIP_ERROR_CODES.has(code) ? "skipped" : "failed";
}

// One lifecycle event for one source (job). `domain` is a bare hostname or null.
export const ProgressEventSchema = z.object({
  type: z.literal("job_progress"),
  id: z.string().uuid(),
  phase: ResearchPhaseSchema,
  domain: z.string().max(255).nullable().default(null),
  elapsedMs: z.number().int().nonnegative().optional(),
  errorCode: ResearchErrorCodeSchema.optional()
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

// Domain-only extraction so activity metadata never leaks a path or query string.
export function safeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "") || null;
  } catch {
    return null;
  }
}

// Maps an extension challengeKind to a structured, skill-usable error code.
export function errorCodeForChallenge(kind: ChallengeKind): ResearchErrorCode {
  if (kind === "captcha") return "blocked_captcha";
  if (kind === "login") return "requires_login";
  return "access_denied";
}

export const JobResultMessageSchema = z.discriminatedUnion("ok", [
  z.object({
    type: z.literal("job_result"),
    id: z.string().uuid(),
    ok: z.literal(true),
    result: z.discriminatedUnion("kind", [PageExtractionSchema, SearchExtractionSchema])
  }),
  z.object({
    type: z.literal("job_result"),
    id: z.string().uuid(),
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string()
    })
  })
]);

export type AuthChallenge = z.infer<typeof AuthChallengeSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type BrowserJob = z.infer<typeof BrowserJobSchema>;
export type JobMessage = z.infer<typeof JobMessageSchema>;
export type PageExtraction = z.infer<typeof PageExtractionSchema>;
export type SearchExtraction = z.infer<typeof SearchExtractionSchema>;
export type JobResultMessage = z.infer<typeof JobResultMessageSchema>;

export function isValidBridgeToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function serverProofPayload(
  channel: z.infer<typeof AuthChannelSchema>,
  nonce: string,
  protocolVersion: number,
  serverBuildId: string
): string {
  return `browser-research|server|${channel}|${nonce}|${protocolVersion}|${serverBuildId}`;
}

export function clientProofPayload(
  channel: z.infer<typeof AuthChannelSchema>,
  nonce: string,
  protocolVersion: number,
  clientId: string,
  clientBuildId: string
): string {
  return `browser-research|client|${channel}|${nonce}|${protocolVersion}|${clientId}|${clientBuildId}`;
}

export function pairingSubmitPayload(nonce: string, extensionId: string, protocolVersion: number): string {
  return `browser-research|pairing-submit|${nonce}|${protocolVersion}|${extensionId}`;
}

export function pairingOkPayload(nonce: string, token: string, port: number, extensionId: string, protocolVersion: number): string {
  return `browser-research|pairing-ok|${nonce}|${protocolVersion}|${extensionId}|${port}|${token}`;
}

export async function hmacSha256Hex(token: string, payload: string): Promise<string> {
  if (!isValidBridgeToken(token)) throw new Error("Bridge token must be exactly 64 lowercase hexadecimal characters");
  return signHmacHex(token, payload);
}

export async function pairingProofHex(pairingCode: string, payload: string): Promise<string> {
  if (!isValidPairingCode(pairingCode)) throw new Error("Pairing code must contain four groups of four hexadecimal characters");
  return signHmacHex(pairingCode, payload);
}

async function signHmacHex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizePairingCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 16);
  return compact.match(/.{1,4}/g)?.join("-") ?? "";
}

export function isValidPairingCode(value: unknown): value is string {
  return typeof value === "string" && PAIRING_CODE_PATTERN.test(value);
}

export function constantTimeHexEqual(actual: string, expected: string): boolean {
  if (!PROOF_PATTERN.test(actual) || !PROOF_PATTERN.test(expected)) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function isAllowedPublicWebUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "home.arpa" ||
    hostname.endsWith(".home.arpa") ||
    hostname === "nip.io" ||
    hostname.endsWith(".nip.io") ||
    hostname === "sslip.io" ||
    hostname.endsWith(".sslip.io") ||
    hostname === "localtest.me" ||
    hostname.endsWith(".localtest.me") ||
    hostname === "lvh.me" ||
    hostname.endsWith(".lvh.me")
  ) {
    return false;
  }

  if (isIpAddressLiteral(hostname)) return isPublicIpAddress(hostname);
  if (!hostname.includes(".")) return false;
  return true;
}

export function isPublicIpAddress(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0] ?? "";
  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isPublicIpv4(ipv4);
  const ipv6 = parseIpv6(normalized);
  if (!ipv6) return false;

  // Only currently allocated global-unicast space (2000::/3) is eligible.
  if ((ipv6[0]! & 0xe0) !== 0x20) return false;
  if (matchesPrefix(ipv6, [0x20, 0x01, 0x00, 0x00], 32)) return false; // Teredo
  if (matchesPrefix(ipv6, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00], 48)) return false; // benchmarking
  if (matchesPrefix(ipv6, [0x20, 0x01, 0x0d, 0xb8], 32)) return false; // documentation
  if (matchesPrefix(ipv6, [0x20, 0x01, 0x00, 0x20], 28)) return false; // ORCHIDv2
  if (matchesPrefix(ipv6, [0x20, 0x02], 16)) return false; // 6to4 embeds IPv4
  return true;
}

function isIpAddressLiteral(hostname: string): boolean {
  return hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname);
}

function parseIpv4(value: string): number[] | null {
  const match = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.some((octet) => octet > 255) ? null : octets;
}

function isPublicIpv4([a = 0, b = 0, c = 0]: number[]): boolean {
  return !(
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6(value: string): number[] | null {
  if (!value.includes(":")) return null;
  let source = value;
  const dottedTail = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (dottedTail) {
    const ipv4 = parseIpv4(dottedTail);
    if (!ipv4) return null;
    const replacement = `${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
    source = source.slice(0, -dottedTail.length) + replacement;
  }

  if ((source.match(/::/g) ?? []).length > 1) return null;
  const [leftSource, rightSource] = source.split("::");
  const left = leftSource ? leftSource.split(":") : [];
  const right = rightSource ? rightSource.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const omitted = 8 - left.length - right.length;
  if (source.includes("::") ? omitted < 1 : omitted !== 0) return null;
  const groups = [...left, ...Array.from({ length: omitted }, () => "0"), ...right].map((part) => parseInt(part, 16));
  if (groups.length !== 8) return null;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function matchesPrefix(address: number[], prefix: number[], bits: number): boolean {
  const wholeBytes = Math.floor(bits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== prefix[index]) return false;
  }
  const remaining = bits % 8;
  if (remaining === 0) return true;
  const mask = 0xff << (8 - remaining);
  return (address[wholeBytes]! & mask) === (prefix[wholeBytes]! & mask);
}
