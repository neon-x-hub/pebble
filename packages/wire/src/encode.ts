/**
 * TCP frame encoder.
 *
 * Wire format:
 *
 *   ┌──────────────┬───────────┬──────────────────┐
 *   │  uint32 len  │ uint8 type│  UTF-8 JSON body │
 *   └──────────────┴───────────┴──────────────────┘
 *
 * - `len` is the byte length of the JSON body only (NOT including the 5-byte header)
 * - `type` is a single byte identifying the message type (see GossipMessageType / ClientMessageType)
 * - The body is compact JSON serialized to UTF-8
 *
 * This format is used by both the inter-node gossip protocol and the client
 * protocol — they differ only in the `type` byte values.
 */

/** The fixed size of the frame header: 4 bytes (uint32 length) + 1 byte (uint8 type). */
export const HEADER_SIZE = 5;

/**
 * Encode a message into a wire frame.
 *
 * @param type  - Message type byte (e.g. GossipMessageType.HELLO or ClientMessageType.GET_REQUEST)
 * @param payload - Any JSON-serialisable value
 * @returns A Buffer containing the complete frame (header + body) ready to send
 */
export function encodeFrame(type: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const frame = Buffer.allocUnsafe(HEADER_SIZE + body.byteLength);
  frame.writeUInt32BE(body.byteLength, 0);
  frame.writeUInt8(type, 4);
  body.copy(frame, HEADER_SIZE);
  return frame;
}
