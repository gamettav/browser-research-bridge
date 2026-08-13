const HEADER_BYTES = 4;
export const MAX_NATIVE_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_NATIVE_OUTPUT_BYTES = 1024 * 1024;

export class NativeMessageDecoder {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  constructor(
    private readonly onMessage: (message: unknown) => void,
    private readonly maxBytes = MAX_NATIVE_INPUT_BYTES
  ) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= HEADER_BYTES) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0 || length > this.maxBytes) {
        throw new Error(`Invalid native message length: ${length}`);
      }
      if (this.buffer.length < HEADER_BYTES + length) return;
      const body = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length);
      this.buffer = this.buffer.subarray(HEADER_BYTES + length);
      this.onMessage(JSON.parse(body.toString("utf8")));
    }
  }
}

export function encodeNativeMessage(message: unknown, maxBytes = MAX_NATIVE_OUTPUT_BYTES): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > maxBytes) throw new Error(`Native message exceeds ${maxBytes} byte output limit`);
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}
