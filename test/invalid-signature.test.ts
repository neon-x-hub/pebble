import { describe, it, expect, afterEach } from "vitest";
import { generateIdentity, signMutation } from "@pebbl/crypto";
import { InvalidSignatureError, UnknownNodeError } from "@pebbl/types";
import { createTestCluster, type TestCluster } from "./helpers.js";

describe("Integration: Invalid Signature & Unknown Node Rejection", () => {
  let cluster: TestCluster;

  afterEach(async () => {
    if (cluster) await cluster.close();
  });

  it("rejects tampered mutations and unrecognized nodes", async () => {
    cluster = await createTestCluster(2);
    const nodeList = Array.from(cluster.nodes.values());
    const nodeA = nodeList[0]!;
    const nodeB = nodeList[1]!.pebble!;

    // 1. Create valid mutation from Node A
    const fields = {
      nodeId: nodeA.nodeId,
      sequence: 1,
      timestamp: Date.now(),
      operation: "put" as const,
      key: "secure-key",
      value: "original-value",
    };
    const validSig = signMutation(nodeA.identity.privateKeyHex, fields);

    // Tamper with the value
    const tamperedMutation = {
      ...fields,
      value: "tampered-value",
      signature: validSig,
    };

    expect(() =>
      nodeB.store.applyMutation(tamperedMutation, {
        publicKeyResolver: (nid) => (nid === nodeA.nodeId ? nodeA.identity.publicKeyHex : undefined),
      }),
    ).toThrow(InvalidSignatureError);

    expect(await nodeB.get("secure-key")).toBeUndefined();

    // 2. Mutation from an unconfigured/rogue node
    const rogueId = generateIdentity();
    const rogueFields = {
      nodeId: rogueId.nodeId,
      sequence: 1,
      timestamp: Date.now(),
      operation: "put" as const,
      key: "rogue-key",
      value: "rogue-val",
    };
    const rogueSig = signMutation(rogueId.privateKeyHex, rogueFields);
    const rogueMutation = { ...rogueFields, signature: rogueSig };

    expect(() =>
      nodeB.store.applyMutation(rogueMutation, {
        publicKeyResolver: (nid) => (nid === nodeA.nodeId ? nodeA.identity.publicKeyHex : undefined),
      }),
    ).toThrow(UnknownNodeError);

    expect(await nodeB.get("rogue-key")).toBeUndefined();
  });
});
