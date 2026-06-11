import type { WebSocket } from "ws";
import { ClientOp, type AckPayload, type ResizePayload } from "@zuzuu-web/protocol";
import { decodeFrame } from "./frames.js";
import type { Session } from "./sessions.js";

export function handleTermSocket(ws: WebSocket, session: Session): void {
  session.attach(ws);

  ws.on("message", (raw, isBinary) => {
    if (!isBinary && !Buffer.isBuffer(raw)) return;
    let frame: { op: number; payload: Buffer };
    try {
      frame = decodeFrame(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer));
    } catch {
      return;
    }
    switch (frame.op) {
      case ClientOp.Input:
        session.write(frame.payload.toString("utf8"));
        break;
      case ClientOp.Resize: {
        try {
          const { cols, rows } = JSON.parse(frame.payload.toString("utf8")) as ResizePayload;
          session.resize(cols, rows);
        } catch {
          // ignore malformed resize
        }
        break;
      }
      case ClientOp.Ack: {
        try {
          const { bytes } = JSON.parse(frame.payload.toString("utf8")) as AckPayload;
          session.ack(bytes);
        } catch {
          // ignore malformed ack
        }
        break;
      }
    }
  });

  ws.on("close", () => session.detach(ws));
}
