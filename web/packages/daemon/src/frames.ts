/**
 * Binary WS framing: 1 opcode byte followed by the payload
 * (raw bytes for I/O frames, UTF-8 JSON for control frames).
 */

export function encodeFrame(op: number, payload: Uint8Array | string = ""): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const buf = Buffer.allocUnsafe(1 + body.length);
  buf[0] = op;
  buf.set(body, 1);
  return buf;
}

export function decodeFrame(data: Buffer): { op: number; payload: Buffer } {
  if (data.length === 0) throw new Error("empty frame");
  return { op: data[0]!, payload: data.subarray(1) };
}
