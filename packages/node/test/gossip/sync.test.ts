import { describe, it, expect } from "vitest";
import { generateIdentity } from "@pebbl/crypto";
import { Store } from "@pebbl/core";
import type { ClusterConfig } from "@pebbl/types";
import { PeerConnection } from "../../src/network/connection.js";
import { runInitiatorSync, handleResponderSync } from "../../src/gossip/sync.js";
import { makeDuplexPair } from "../testHelpers.js";

function makeConfig(nodes: Record<string, string>): ClusterConfig {
  const nodeRecords: Record<string, { publicKey: string }> = {};
  for (const [id, pub] of Object.entries(nodes)) {
    nodeRecords[id] = { publicKey: pub };
  }

  return {
    clusterId: "sync-cluster",
    moderatorPublicKey: "mod-pub",
    nodes: nodeRecords,
    gossipIntervalMs: 5000,
    pingIntervalMs: 3000,
    unhealthyThresholdMs: 15000,
    gossipPort: 7000,
    clientPort: 7001,
    limits: {
      maxMessageBytes: 10485760,
      maxMutationsPerMessage: 500,
      maxRangesPerRequest: 100,
      maxKeyBytes: 1024,
      maxValueBytes: 1048576,
    },
  };
}

describe("Gossip Pull Sync", () => {
  it("synchronizes missing mutations between two stores", async () => {
    const idA = generateIdentity();
    const idB = generateIdentity();

    const config = makeConfig({
      [idA.nodeId]: idA.publicKeyHex,
      [idB.nodeId]: idB.publicKeyHex,
    });

    const storeA = new Store(idA.nodeId);
    const storeB = new Store(idB.nodeId);

    // Node A writes keys 1..3
    storeA.localPut("k1", "v1", idA);
    storeA.localPut("k2", "v2", idA);
    storeA.localPut("k3", "v3", idA);

    // Node B writes key k4
    storeB.localPut("k4", "v4", idB);

    const [sockA, sockB] = makeDuplexPair();
    const connA = new PeerConnection(sockA);
    const connB = new PeerConnection(sockB);

    // Run sync session: A is initiator, B is responder
    await Promise.all([
      runInitiatorSync(connA, storeA, config),
      handleResponderSync(connB, storeB, config),
    ]);

    // Store A should have k4 from B
    expect(storeA.get("k4")).toBe("v4");

    // Store B should have k1, k2, k3 from A
    expect(storeB.get("k1")).toBe("v1");
    expect(storeB.get("k2")).toBe("v2");
    expect(storeB.get("k3")).toBe("v3");
  });
});
