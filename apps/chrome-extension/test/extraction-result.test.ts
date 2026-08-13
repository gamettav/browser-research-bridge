import { describe, expect, it } from "vitest";
import { unwrapExtractionResult } from "../src/extraction-result.js";

describe("unwrapExtractionResult", () => {
  it("returns a successful extraction unchanged", () => {
    const result = { kind: "page", markdown: "hello" };
    expect(unwrapExtractionResult(result)).toBe(result);
  });

  it("turns extractor responses into immediate typed errors", () => {
    expect(() => unwrapExtractionResult({ error: "Readability failed" })).toThrowError(
      expect.objectContaining({ message: "Readability failed", code: "extraction_failed" })
    );
  });
});
