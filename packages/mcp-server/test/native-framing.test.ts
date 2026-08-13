import { describe, expect, it, vi } from "vitest";
import { NativeMessageDecoder, encodeNativeMessage } from "../src/native-framing.js";

describe("Native Messaging framing", () => {
  it("encodes and decodes a JSON message", () => {
    const onMessage = vi.fn();
    const decoder = new NativeMessageDecoder(onMessage);
    decoder.push(encodeNativeMessage({ type: "auth_challenge", nonce: "a".repeat(64) }));
    expect(onMessage).toHaveBeenCalledWith({ type: "auth_challenge", nonce: "a".repeat(64) });
  });

  it("handles split and adjacent frames", () => {
    const messages: unknown[] = [];
    const decoder = new NativeMessageDecoder((message) => messages.push(message));
    const combined = Buffer.concat([encodeNativeMessage({ one: 1 }), encodeNativeMessage({ two: 2 })]);
    decoder.push(combined.subarray(0, 7));
    decoder.push(combined.subarray(7));
    expect(messages).toEqual([{ one: 1 }, { two: 2 }]);
  });

  it("rejects invalid frame lengths and oversized output", () => {
    const decoder = new NativeMessageDecoder(() => undefined, 8);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(9);
    expect(() => decoder.push(header)).toThrow("Invalid native message length");
    expect(() => encodeNativeMessage({ long: "message" }, 4)).toThrow("output limit");
  });
});
