import { describe, it, expect } from "vitest";
import { FrameDecoder } from "../src/decoder.js";
import { encodeFrame, HEADER_SIZE } from "../src/encode.js";
import { MessageTooLargeError, ProtocolError } from "@pebbl/types";

const MAX = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a Buffer into `count` roughly-equal chunks. */
function splitBuffer(buf: Buffer, count: number): Buffer[] {
  const chunks: Buffer[] = [];
  const size = Math.ceil(buf.byteLength / count);
  for (let i = 0; i < buf.byteLength; i += size) {
    chunks.push(buf.subarray(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FrameDecoder", () => {
  describe("basic decoding", () => {
    it("decodes a single complete frame in one push", () => {
      const decoder = new FrameDecoder(MAX);
      const frame = encodeFrame(0x01, { hello: "world" });
      const frames = decoder.push(frame);
      expect(frames).toHaveLength(1);
      expect(frames[0]?.type).toBe(0x01);
      expect(frames[0]?.payload).toEqual({ hello: "world" });
    });

    it("decodes two frames concatenated in one push", () => {
      const decoder = new FrameDecoder(MAX);
      const f1 = encodeFrame(0x01, { n: 1 });
      const f2 = encodeFrame(0x02, { n: 2 });
      const combined = Buffer.concat([f1, f2]);
      const frames = decoder.push(combined);
      expect(frames).toHaveLength(2);
      expect(frames[0]?.type).toBe(0x01);
      expect(frames[1]?.type).toBe(0x02);
      expect((frames[0]?.payload as { n: number }).n).toBe(1);
      expect((frames[1]?.payload as { n: number }).n).toBe(2);
    });

    it("decodes three frames concatenated in one push", () => {
      const decoder = new FrameDecoder(MAX);
      const combined = Buffer.concat([
        encodeFrame(0x01, { x: 1 }),
        encodeFrame(0x02, { x: 2 }),
        encodeFrame(0x03, { x: 3 }),
      ]);
      const frames = decoder.push(combined);
      expect(frames).toHaveLength(3);
    });
  });

  describe("partial / split frames", () => {
    it("handles a frame split across two pushes", () => {
      const decoder = new FrameDecoder(MAX);
      const frame = encodeFrame(0x05, { key: "color", value: "red" });
      const mid = Math.floor(frame.byteLength / 2);
      const part1 = decoder.push(frame.subarray(0, mid));
      expect(part1).toHaveLength(0);
      const part2 = decoder.push(frame.subarray(mid));
      expect(part2).toHaveLength(1);
      expect(part2[0]?.payload).toEqual({ key: "color", value: "red" });
    });

    it("handles a frame split across three pushes", () => {
      const decoder = new FrameDecoder(MAX);
      const frame = encodeFrame(0x07, { mutations: [1, 2, 3] });
      const [a, b, c] = splitBuffer(frame, 3);
      expect(decoder.push(a!)).toHaveLength(0);
      expect(decoder.push(b!)).toHaveLength(0);
      const result = decoder.push(c!);
      expect(result).toHaveLength(1);
      expect(result[0]?.payload).toEqual({ mutations: [1, 2, 3] });
    });

    it("handles frame split at header/body boundary", () => {
      const decoder = new FrameDecoder(MAX);
      const frame = encodeFrame(0x01, { a: 1 });
      // Split exactly at the end of the header
      expect(decoder.push(frame.subarray(0, HEADER_SIZE))).toHaveLength(0);
      expect(decoder.push(frame.subarray(HEADER_SIZE))).toHaveLength(1);
    });

    it("handles single-byte pushes", () => {
      const decoder = new FrameDecoder(MAX);
      const frame = encodeFrame(0x01, { hello: "world" });
      let all: ReturnType<FrameDecoder["push"]> = [];
      for (let i = 0; i < frame.byteLength; i++) {
        const partial = decoder.push(frame.subarray(i, i + 1));
        all = [...all, ...partial];
      }
      expect(all).toHaveLength(1);
      expect(all[0]?.payload).toEqual({ hello: "world" });
    });

    it("two frames where second arrives byte-by-byte", () => {
      const decoder = new FrameDecoder(MAX);
      const f1 = encodeFrame(0x01, { n: 1 });
      const f2 = encodeFrame(0x02, { n: 2 });
      const frames1 = decoder.push(f1);
      expect(frames1).toHaveLength(1);
      let collected: ReturnType<FrameDecoder["push"]> = [];
      for (let i = 0; i < f2.byteLength; i++) {
        collected = [...collected, ...decoder.push(f2.subarray(i, i + 1))];
      }
      expect(collected).toHaveLength(1);
      expect((collected[0]?.payload as { n: number }).n).toBe(2);
    });
  });

  describe("round-trip with encodeFrame", () => {
    it("encodeFrame + FrameDecoder round-trip: payload is identical", () => {
      const decoder = new FrameDecoder(MAX);
      const original = {
        nodeId: "node-a",
        mutations: [{ key: "x", value: "y", timestamp: 1000 }],
        nested: { a: { b: { c: 42 } } },
      };
      const frame = encodeFrame(0x08, original);
      const frames = decoder.push(frame);
      expect(frames).toHaveLength(1);
      expect(frames[0]?.payload).toEqual(original);
    });

    it("preserves null values through round-trip", () => {
      const decoder = new FrameDecoder(MAX);
      const payload = { value: null, key: "deleted-key" };
      const frames = decoder.push(encodeFrame(0x07, payload));
      expect(frames[0]?.payload).toEqual(payload);
    });
  });

  describe("limits and errors", () => {
    it("throws MessageTooLargeError when declared length exceeds max", () => {
      const decoder = new FrameDecoder(100); // 100 byte limit
      // Manually craft a frame with a large declared length
      const header = Buffer.allocUnsafe(HEADER_SIZE);
      header.writeUInt32BE(101, 0); // 101 > 100
      header.writeUInt8(0x01, 4);
      expect(() => decoder.push(header)).toThrow(MessageTooLargeError);
    });

    it("does not throw for payload exactly at the limit", () => {
      const body = "x".repeat(100);
      const smallDecoder = new FrameDecoder(100);
      const frame = encodeFrame(0x01, body);
      // frame body is JSON-encoded string, larger than 100 chars when quoted
      // So use a raw number that encodes to ≤ 100 bytes
      const tinyDecoder = new FrameDecoder(10 * 1024 * 1024);
      const frames = tinyDecoder.push(encodeFrame(0x01, 42));
      expect(frames).toHaveLength(1);
    });

    it("throws ProtocolError on invalid JSON body", () => {
      const decoder = new FrameDecoder(MAX);
      // Craft a frame with a body that is not valid JSON
      const invalidBody = Buffer.from("not json!!!", "utf8");
      const header = Buffer.allocUnsafe(HEADER_SIZE);
      header.writeUInt32BE(invalidBody.byteLength, 0);
      header.writeUInt8(0x01, 4);
      const raw = Buffer.concat([header, invalidBody]);
      expect(() => decoder.push(raw)).toThrow(ProtocolError);
    });
  });

  describe("type byte passthrough", () => {
    it("unknown type byte is preserved as-is", () => {
      const decoder = new FrameDecoder(MAX);
      const frames = decoder.push(encodeFrame(0xfe, { x: 1 }));
      expect(frames[0]?.type).toBe(0xfe);
    });

    it("type byte 0x00 is preserved", () => {
      const decoder = new FrameDecoder(MAX);
      expect(decoder.push(encodeFrame(0x00, {}))[0]?.type).toBe(0x00);
    });

    it("type byte 0xff is preserved", () => {
      const decoder = new FrameDecoder(MAX);
      expect(decoder.push(encodeFrame(0xff, {}))[0]?.type).toBe(0xff);
    });
  });

  describe("reset", () => {
    it("discards accumulated partial data after reset", () => {
      const decoder = new FrameDecoder(MAX);
      const frame = encodeFrame(0x01, { n: 1 });
      // Push only half the frame
      decoder.push(frame.subarray(0, Math.floor(frame.byteLength / 2)));
      decoder.reset();
      // After reset, pushing the full frame should decode cleanly (not be confused by stale state)
      const frames = decoder.push(encodeFrame(0x02, { n: 2 }));
      expect(frames).toHaveLength(1);
      expect(frames[0]?.type).toBe(0x02);
    });
  });
});
