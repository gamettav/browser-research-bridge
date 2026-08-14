import { isAllowedPublicWebUrl, isPublicIpAddress } from "@groundtab/protocol";

export type DnsResolve = (hostname: string) => Promise<{ resultCode: number; address?: string }>;
export type NavigationPolicyMode = "literal" | "broker-only" | "browser-dns";

export async function assertNavigationUrl(value: string, resolveDns?: DnsResolve): Promise<NavigationPolicyMode> {
  if (!isAllowedPublicWebUrl(value)) throw policyError("blocked_url", "URL is outside the public HTTP(S) policy");
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(hostname)) {
    if (!isPublicIpAddress(hostname)) throw policyError("blocked_dns", "URL uses a non-public IP address");
    return "literal";
  }

  // chrome.dns is Dev-channel-only. Stable browsers rely on the broker's
  // mandatory all-answer DNS check instead of making navigation unusable.
  if (!resolveDns) return "broker-only";
  const resolution = await resolveDns(hostname);
  if (resolution.resultCode !== 0 || !resolution.address) {
    throw policyError("dns_failed", `Chrome could not resolve ${hostname}`);
  }
  if (!isPublicIpAddress(resolution.address)) {
    throw policyError("blocked_dns", `Chrome DNS policy blocked ${hostname}: non-public address`);
  }
  return "browser-dns";
}

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname);
}

function policyError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
