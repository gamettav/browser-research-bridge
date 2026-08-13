import { describe, expect, it, vi } from "vitest";
import { assertPublicResolvedUrl } from "../src/dns-policy.js";

describe("assertPublicResolvedUrl", () => {
  it("accepts a hostname only when every resolved address is public", async () => {
    const resolver = vi.fn().mockResolvedValue([{ address: "93.184.216.34" }, { address: "2606:2800:220:1::" }]);
    await expect(assertPublicResolvedUrl("https://example.com/article", resolver)).resolves.toBeUndefined();
    expect(resolver).toHaveBeenCalledWith("example.com");
  });

  it.each(["127.0.0.1", "::ffff:127.0.0.1", "169.254.169.254", "fc00::1"])(
    "rejects a hostname when any answer is non-public: %s",
    async (address) => {
      const resolver = vi.fn().mockResolvedValue([{ address: "93.184.216.34" }, { address }]);
      await expect(assertPublicResolvedUrl("https://attacker.example/", resolver)).rejects.toThrow("non-public address");
    }
  );

  it("fails closed when DNS cannot resolve", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("NXDOMAIN"));
    await expect(assertPublicResolvedUrl("https://missing.example/", resolver)).rejects.toThrow("DNS resolution failed");
  });
});
