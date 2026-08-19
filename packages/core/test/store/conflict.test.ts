import { describe, it, expect } from "vitest";
import { compare, winner } from "../../src/store/conflict.js";
import type { Mutation } from "@pebbl/types";

function makeMutation(overrides: Partial<Mutation>): Mutation {
  return {
    nodeId: "node-a",
    sequence: 1,
    timestamp: 1000,
    operation: "put",
    key: "foo",
    value: "bar",
    signature: "sig",
    ...overrides,
  };
}

describe("LWW conflict resolution (compare & winner)", () => {
  it("higher timestamp wins", () => {
    const m1 = makeMutation({ timestamp: 1000, nodeId: "node-a" });
    const m2 = makeMutation({ timestamp: 2000, nodeId: "node-b" });

    expect(compare(m2, m1)).toBeGreaterThan(0);
    expect(compare(m1, m2)).toBeLessThan(0);
    expect(winner(m1, m2)).toBe(m2);
  });

  it("ties broken deterministically by nodeId in lexicographical order", () => {
    const mA = makeMutation({ timestamp: 1000, nodeId: "node-a" });
    const mB = makeMutation({ timestamp: 1000, nodeId: "node-b" });

    expect(compare(mB, mA)).toBeGreaterThan(0);
    expect(compare(mA, mB)).toBeLessThan(0);
    expect(winner(mA, mB)).toBe(mB);
  });

  it("same timestamp and nodeId evaluates to equal", () => {
    const m1 = makeMutation({ timestamp: 1000, nodeId: "node-a" });
    const m2 = makeMutation({ timestamp: 1000, nodeId: "node-a" });

    expect(compare(m1, m2)).toBe(0);
    expect(winner(m1, m2)).toBe(m1); // incumbent retained on tie
  });
});
