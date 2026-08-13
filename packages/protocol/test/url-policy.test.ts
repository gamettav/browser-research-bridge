import { describe, expect, it } from "vitest";
import { isAllowedPublicWebUrl, isPublicIpAddress } from "../src/index.js";

describe("isAllowedPublicWebUrl", () => {
  it.each([
    "https://example.com/article",
    "http://example.org",
    "https://8.8.8.8/",
    "https://[2606:4700:4700::1111]/"
  ])("allows public web URL %s", (url) => {
    expect(isAllowedPublicWebUrl(url)).toBe(true);
  });

  it.each([
    "file:///tmp/a",
    "chrome://settings",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://10.0.0.1",
    "http://172.16.4.2",
    "http://192.168.1.1",
    "http://169.254.169.254",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://[2001:db8::1]/",
    "http://127.0.0.1.nip.io/",
    "http://metadata.google.internal/"
  ])("blocks non-public URL %s", (url) => {
    expect(isAllowedPublicWebUrl(url)).toBe(false);
  });
});

describe("isPublicIpAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "100.64.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "203.0.113.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "2001:db8::1",
    "2002:7f00:1::"
  ])("blocks non-public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });
});
