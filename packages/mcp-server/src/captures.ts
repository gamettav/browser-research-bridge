import { createHash, randomUUID } from "node:crypto";
import type { PageExtraction } from "@browser-research/protocol";

export type CaptureBlock = {
  id: string;
  text: string;
};

export type Capture = {
  id: string;
  title: string;
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string | null;
  capturedAt: string;
  contentHash: string;
  blocks: CaptureBlock[];
  links: PageExtraction["links"];
  metadata: Pick<PageExtraction, "siteName" | "byline" | "excerpt" | "language" | "challenge">;
};

export class CaptureStore {
  private readonly captures = new Map<string, Capture>();

  constructor(private readonly maxCaptures = 50) {
    if (!Number.isInteger(maxCaptures) || maxCaptures < 1) throw new Error("maxCaptures must be a positive integer");
  }

  add(page: PageExtraction): Capture {
    const id = randomUUID();
    const blocks = splitBlocks(page.markdown);
    const capture: Capture = {
      id,
      title: page.title,
      requestedUrl: page.requestedUrl,
      finalUrl: page.finalUrl,
      canonicalUrl: page.canonicalUrl,
      capturedAt: page.capturedAt,
      contentHash: createHash("sha256").update(page.markdown).digest("hex"),
      blocks,
      links: page.links,
      metadata: {
        siteName: page.siteName,
        byline: page.byline,
        excerpt: page.excerpt,
        language: page.language,
        challenge: page.challenge
      }
    };
    this.captures.set(id, capture);
    while (this.captures.size > this.maxCaptures) {
      const oldest = this.captures.keys().next().value;
      if (typeof oldest !== "string") break;
      this.captures.delete(oldest);
    }
    return capture;
  }

  get(id: string): Capture | undefined {
    return this.captures.get(id);
  }

  list(): Capture[] {
    return [...this.captures.values()].reverse();
  }
}

export function splitBlocks(markdown: string): CaptureBlock[] {
  return markdown
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({ id: `B${String(index + 1).padStart(4, "0")}`, text }));
}
