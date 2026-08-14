import { lookup } from "node:dns/promises";
import { isAllowedPublicWebUrl, isPublicIpAddress } from "@groundtab/protocol";

export type DnsLookup = (hostname: string) => Promise<Array<{ address: string }>>;

export async function assertPublicResolvedUrl(value: string, resolveHostname: DnsLookup = systemLookup): Promise<void> {
  if (!isAllowedPublicWebUrl(value)) throw new Error("URL is outside the public HTTP(S) policy");
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(hostname)) {
    if (!isPublicIpAddress(hostname)) throw new Error("URL resolves to a non-public IP address");
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolveHostname(hostname);
  } catch (error) {
    throw new Error(`DNS resolution failed for ${hostname}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (addresses.length === 0) throw new Error(`DNS resolution returned no addresses for ${hostname}`);
  const blocked = addresses.find(({ address }) => !isPublicIpAddress(address));
  if (blocked) throw new Error(`DNS policy blocked ${hostname}: resolved to non-public address ${blocked.address}`);
}

async function systemLookup(hostname: string): Promise<Array<{ address: string }>> {
  return lookup(hostname, { all: true, verbatim: true });
}

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname);
}
