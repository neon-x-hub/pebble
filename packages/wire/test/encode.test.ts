import { describe, it, expect } from "vitest";
import { encodeFrame, HEADER_SIZE } from "../src/encode.js";

describe("encodeFrame", () => {
  it("produces a Buffer", () => {
    const frame = encodeFrame(0x01, { hello: "world" });
    expect(Buffer.isBuffer(frame)).toBe(true);
  });

  it("header is HEADER_SIZE bytes before the body", () => {
    const payload = { hello: "world" };
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const frame = encodeFrame(0x01, payload);
    expect(frame.byteLength).toBe(HEADER_SIZE + body.byteLength);
  });

  it("length header matches actual body byte length", () => {
    const payload = { key: "color", value: "red" };
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const frame = encodeFrame(0x07, payload);
    const declaredLength = frame.readUInt32BE(0);
    expect(declaredLength).toBe(body.byteLength);
  });

  it("type byte is at offset 4", () => {
    const frame = encodeFrame(0x42, {});
    expect(frame.readUInt8(4)).toBe(0x42);
  });

  it("body is valid UTF-8 JSON", () => {
    const payload = { a: 1, b: "hello" };
    const frame = encodeFrame(0x01, payload);
    const bodyLength = frame.readUInt32BE(0);
    const body = frame.subarray(HEADER_SIZE, HEADER_SIZE + bodyLength);
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    expect(parsed).toEqual(payload);
  });

  it("encodes null payload", () => {
    const frame = encodeFrame(0x01, null);
    const bodyLength = frame.readUInt32BE(0);
    const body = frame.subarray(HEADER_SIZE, HEADER_SIZE + bodyLength);
    expect(body.toString()).toBe("null");
  });

  it("type byte 0x00 is valid", () => {
    const frame = encodeFrame(0x00, {});
    expect(frame.readUInt8(4)).toBe(0x00);
  });

  it("type byte 0xff is valid", () => {
    const frame = encodeFrame(0xff, {});
    expect(frame.readUInt8(4)).toBe(0xff);
  });
});
