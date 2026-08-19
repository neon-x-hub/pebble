import { describe, it, expect } from "vitest";
import { generateIdentity, signMutation } from "@pebbl/crypto";
import { Store } from "../../src/store/store.js";
import {
  InvalidSignatureError,
  SequenceCollisionError,
  UnknownNodeError,
} from "@pebbl/types";
import { createMutation } from "../../src/store/mutation.js";

describe("Store", () => {
  it("handles localPut, get, has, keys, entries, localDelete", () => {
    const id = generateIdentity();
    const store = new Store(id.nodeId);

    expect(store.get("k1")).toBeUndefined();
    expect(store.has("k1")).toBe(false);

    store.localPut("k1", "v1", id);
    expect(store.get("k1")).toBe("v1");
    expect(store.has("k1")).toBe(true);
    expect(store.keys()).toEqual(["k1"]);
    expect(store.entries()).toEqual([["k1", "v1"]]);

    store.localPut("k2", "v2", id);
    expect(store.keys().sort()).toEqual(["k1", "k2"]);

    store.localDelete("k1", id);
    expect(store.get("k1")).toBeUndefined();
    expect(store.has("k1")).toBe(false);
    expect(store.keys()).toEqual(["k2"]);
    expect(store.entries()).toEqual([["k2", "v2"]]);
  });

  it("applies external mutations with valid signature", () => {
    const localId = generateIdentity();
    const remoteId = generateIdentity();
    const store = new Store(localId.nodeId);

    const m = createMutation({
      identity: remoteId,
      sequence: 1,
      operation: "put",
      key: "remoteKey",
      value: "remoteVal",
    });

    const applied = store.applyMutation(m, {
      publicKeyResolver: (nid) => (nid === remoteId.nodeId ? remoteId.publicKeyHex : undefined),
    });

    expect(applied).toBe(true);
    expect(store.get("remoteKey")).toBe("remoteVal");
    expect(store.getVersionVector()[remoteId.nodeId]).toBe(1);
  });

  it("rejects unknown node with UnknownNodeError", () => {
    const localId = generateIdentity();
    const remoteId = generateIdentity();
    const store = new Store(localId.nodeId);

    const m = createMutation({
      identity: remoteId,
      sequence: 1,
      operation: "put",
      key: "k",
      value: "v",
    });

    expect(() =>
      store.applyMutation(m, {
        publicKeyResolver: () => undefined, // unknown
      }),
    ).toThrow(UnknownNodeError);
  });

  it("rejects tampered signature with InvalidSignatureError", () => {
    const localId = generateIdentity();
    const remoteId = generateIdentity();
    const store = new Store(localId.nodeId);

    const m = createMutation({
      identity: remoteId,
      sequence: 1,
      operation: "put",
      key: "k",
      value: "v",
    });

    const tampered = { ...m, value: "tampered-value" };

    expect(() =>
      store.applyMutation(tampered, {
        publicKeyResolver: () => remoteId.publicKeyHex,
      }),
    ).toThrow(InvalidSignatureError);
  });

  it("handles duplicate application idempotently", () => {
    const localId = generateIdentity();
    const store = new Store(localId.nodeId);

    const m = createMutation({
      identity: localId,
      sequence: 1,
      operation: "put",
      key: "k",
      value: "v",
    });

    const first = store.applyMutation(m, {
      skipSignatureVerification: true,
    });
    expect(first).toBe(true);

    const second = store.applyMutation(m, {
      skipSignatureVerification: true,
    });
    expect(second).toBe(false); // Duplicate returned false
    expect(store.get("k")).toBe("v");
  });

  it("detects sequence collision and throws SequenceCollisionError", () => {
    const id = generateIdentity();
    const store = new Store(id.nodeId);

    const m1 = createMutation({
      identity: id,
      sequence: 1,
      operation: "put",
      key: "k",
      value: "original",
      timestamp: 1000,
    });

    const m2 = createMutation({
      identity: id,
      sequence: 1, // collision!
      operation: "put",
      key: "k",
      value: "different",
      timestamp: 2000,
    });

    store.applyMutation(m1, { skipSignatureVerification: true });

    expect(() =>
      store.applyMutation(m2, { skipSignatureVerification: true }),
    ).toThrow(SequenceCollisionError);
  });

  it("resolves concurrent conflicting mutations using LWW", () => {
    const idA = generateIdentity();
    const idB = generateIdentity();
    const store = new Store(idA.nodeId);

    const older = createMutation({
      identity: idA,
      sequence: 1,
      operation: "put",
      key: "k",
      value: "olderVal",
      timestamp: 1000,
    });

    const newer = createMutation({
      identity: idB,
      sequence: 1,
      operation: "put",
      key: "k",
      value: "newerVal",
      timestamp: 2000,
    });

    store.applyMutation(older, { skipSignatureVerification: true });
    expect(store.get("k")).toBe("olderVal");

    store.applyMutation(newer, { skipSignatureVerification: true });
    expect(store.get("k")).toBe("newerVal");

    // Applying older mutation again when newer is incumbent should not overwrite
    store.applyMutation(older, { skipSignatureVerification: true });
    expect(store.get("k")).toBe("newerVal");
  });

  it("retrieves missing ranges and mutations in ranges for gossip", () => {
    const idA = generateIdentity();
    const store = new Store(idA.nodeId);

    store.localPut("k1", "v1", idA);
    store.localPut("k2", "v2", idA);
    store.localPut("k3", "v3", idA);

    const missing = store.computeMissingRanges({ [idA.nodeId]: 1 });
    expect(missing).toEqual([{ nodeId: idA.nodeId, from: 2, to: 3 }]);

    const mutations = store.getMutationsInRanges(missing);
    expect(mutations).toHaveLength(2);
    expect(mutations[0]?.sequence).toBe(2);
    expect(mutations[1]?.sequence).toBe(3);
  });
});
