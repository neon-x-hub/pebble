import { describe, it, expect } from "vitest";
import { generateIdentity, verifyMutation } from "@pebbl/crypto";
import { InvalidMutationError } from "@pebbl/types";
import {
  mutationId,
  createMutation,
  validateMutationStructure,
  advanceVector,
  getMissingRanges,
} from "../../src/store/mutation.js";

describe("mutationId", () => {
  it("formats as nodeId:sequence", () => {
    expect(mutationId({ nodeId: "node-1", sequence: 42 })).toBe("node-1:42");
  });
});

describe("createMutation", () => {
  it("creates a signed put mutation", () => {
    const identity = generateIdentity();
    const mutation = createMutation({
      identity,
      sequence: 1,
      operation: "put",
      key: "foo",
      value: "bar",
      timestamp: 1000,
    });

    expect(mutation.nodeId).toBe(identity.nodeId);
    expect(mutation.sequence).toBe(1);
    expect(mutation.operation).toBe("put");
    expect(mutation.key).toBe("foo");
    expect(mutation.value).toBe("bar");
    expect(mutation.timestamp).toBe(1000);
    expect(typeof mutation.signature).toBe("string");
    expect(verifyMutation(identity.publicKeyHex, mutation)).toBe(true);
  });

  it("creates a signed delete mutation (tombstone)", () => {
    const identity = generateIdentity();
    const mutation = createMutation({
      identity,
      sequence: 2,
      operation: "delete",
      key: "foo",
      value: null,
    });

    expect(mutation.operation).toBe("delete");
    expect(mutation.value).toBeNull();
    expect(verifyMutation(identity.publicKeyHex, mutation)).toBe(true);
  });

  it("throws InvalidMutationError if put has null value", () => {
    const identity = generateIdentity();
    expect(() =>
      createMutation({
        identity,
        sequence: 1,
        operation: "put",
        key: "foo",
        value: null,
      }),
    ).toThrow(InvalidMutationError);
  });

  it("throws InvalidMutationError if delete has non-null value", () => {
    const identity = generateIdentity();
    expect(() =>
      createMutation({
        identity,
        sequence: 1,
        operation: "delete",
        key: "foo",
        value: "not-null",
      }),
    ).toThrow(InvalidMutationError);
  });
});

describe("validateMutationStructure", () => {
  it("accepts valid mutation", () => {
    const identity = generateIdentity();
    const m = createMutation({
      identity,
      sequence: 1,
      operation: "put",
      key: "foo",
      value: "bar",
    });
    expect(validateMutationStructure(m)).toEqual(m);
  });

  it("rejects non-object or null", () => {
    expect(() => validateMutationStructure(null)).toThrow(InvalidMutationError);
    expect(() => validateMutationStructure("str")).toThrow(InvalidMutationError);
  });

  it("rejects invalid sequence", () => {
    expect(() =>
      validateMutationStructure({
        nodeId: "n1",
        sequence: -1,
        timestamp: 1000,
        operation: "put",
        key: "k",
        value: "v",
        signature: "sig",
      }),
    ).toThrow(InvalidMutationError);
  });
});

describe("advanceVector and getMissingRanges", () => {
  it("advances version vector monotonically", () => {
    const vec: Record<string, number> = {};
    advanceVector(vec, { nodeId: "n1", sequence: 5 });
    expect(vec["n1"]).toBe(5);

    advanceVector(vec, { nodeId: "n1", sequence: 3 });
    expect(vec["n1"]).toBe(5); // did not regress

    advanceVector(vec, { nodeId: "n1", sequence: 8 });
    expect(vec["n1"]).toBe(8);
  });

  it("computes missing ranges accurately", () => {
    const ourVec = { "n1": 10, "n2": 5 };
    const theirVec = { "n1": 7, "n2": 5 };

    const ranges = getMissingRanges(ourVec, theirVec);
    expect(ranges).toEqual([{ nodeId: "n1", from: 8, to: 10 }]);
  });
});
