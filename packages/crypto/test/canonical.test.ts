import { describe, it, expect } from "vitest";
import { canonicalEncode } from "../src/canonical.js";

describe("canonicalEncode", () => {
  it("produces identical bytes regardless of property insertion order", () => {
    const a = canonicalEncode({ b: 1, a: 2 });
    const b = canonicalEncode({ a: 2, b: 1 });
    expect(a).toEqual(b);
    expect(a.toString()).toBe('{"a":2,"b":1}');
  });

  it("sorts keys recursively in nested objects", () => {
    const result = canonicalEncode({ z: { y: 1, x: 2 }, a: 0 });
    expect(result.toString()).toBe('{"a":0,"z":{"x":2,"y":1}}');
  });

  it("preserves null values", () => {
    const result = canonicalEncode({ value: null, key: "hello" });
    expect(result.toString()).toBe('{"key":"hello","value":null}');
  });

  it("preserves numbers without coercion", () => {
    const result = canonicalEncode({ n: 1787060000000 });
    expect(result.toString()).toBe('{"n":1787060000000}');
  });

  it("preserves array element order", () => {
    const a = canonicalEncode({ arr: [3, 1, 2] });
    const b = canonicalEncode({ arr: [1, 2, 3] });
    expect(a.toString()).toBe('{"arr":[3,1,2]}');
    expect(b.toString()).toBe('{"arr":[1,2,3]}');
    expect(a).not.toEqual(b);
  });

  it("sorts object keys inside arrays", () => {
    const result = canonicalEncode({ arr: [{ b: 1, a: 0 }] });
    expect(result.toString()).toBe('{"arr":[{"a":0,"b":1}]}');
  });

  it("returns a Buffer", () => {
    const result = canonicalEncode({ x: 1 });
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("is valid UTF-8 JSON", () => {
    const result = canonicalEncode({ key: "héllo", value: "wörld" });
    const parsed: unknown = JSON.parse(result.toString("utf8"));
    expect(parsed).toEqual({ key: "héllo", value: "wörld" });
  });

  it("produces compact JSON (no whitespace)", () => {
    const result = canonicalEncode({ a: 1, b: 2 });
    expect(result.toString()).not.toContain(" ");
    expect(result.toString()).not.toContain("\n");
  });
});
