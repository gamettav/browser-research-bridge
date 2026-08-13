import { describe, expect, it } from "vitest";
import { CaptureStore, splitBlocks } from "../src/captures.js";

describe("splitBlocks", () => {
  it("creates stable block labels and removes empty blocks", () => {
    expect(splitBlocks("# Heading\n\nFirst paragraph.\n\n\nSecond paragraph.")).toEqual([
      { id: "B0001", text: "# Heading" },
      { id: "B0002", text: "First paragraph." },
      { id: "B0003", text: "Second paragraph." }
    ]);
  });
});

describe("CaptureStore", () => {
  it("evicts the oldest capture when the retention limit is reached", () => {
    const store = new CaptureStore(2);
    const first = store.add(page("First"));
    const second = store.add(page("Second"));
    const third = store.add(page("Third"));
    expect(store.get(first.id)).toBeUndefined();
    expect(store.list().map((capture) => capture.id)).toEqual([third.id, second.id]);
  });
});

function page(title: string) {
  return {
    kind: "page" as const,
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    canonicalUrl: "https://example.com/",
    title,
    siteName: null,
    byline: null,
    excerpt: null,
    language: "en",
    markdown: `${title} content`,
    textLength: title.length + 8,
    links: [],
    capturedAt: new Date().toISOString(),
    challenge: false,
    challengeKind: null
  };
}
