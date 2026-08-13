import { describe, expect, it, vi } from "vitest";
import { assertNavigationUrl } from "../src/navigation-policy.js";

describe("assertNavigationUrl", () => {
  it("allows public hostnames when chrome.dns is absent in stable Chrome", async () => {
    await expect(assertNavigationUrl("https://example.com/article", undefined)).resolves.toBe("broker-only");
  });

  it("still rejects private IP literals without chrome.dns", async () => {
    await expect(assertNavigationUrl("http://127.0.0.1/", undefined)).rejects.toMatchObject({ code: "blocked_url" });
    await expect(assertNavigationUrl("http://[::ffff:127.0.0.1]/", undefined)).rejects.toMatchObject({ code: "blocked_url" });
  });

  it("uses the additional browser check when the Dev-channel API exists", async () => {
    const resolve = vi.fn().mockResolvedValue({ resultCode: 0, address: "93.184.216.34" });
    await expect(assertNavigationUrl("https://example.com/", resolve)).resolves.toBe("browser-dns");
    expect(resolve).toHaveBeenCalledWith("example.com");
  });

  it("rejects a private answer returned by the optional browser resolver", async () => {
    const resolve = vi.fn().mockResolvedValue({ resultCode: 0, address: "10.0.0.7" });
    await expect(assertNavigationUrl("https://attacker.example/", resolve)).rejects.toMatchObject({ code: "blocked_dns" });
  });
});
