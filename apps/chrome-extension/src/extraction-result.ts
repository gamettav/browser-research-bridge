export function unwrapExtractionResult(value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    throw Object.assign(new Error(value.error), { code: "extraction_failed" });
  }
  return value;
}
