import { describe, it, expect } from "vitest";
import { generateIdentity } from "@pebbl/crypto";
import type { ClusterConfig } from "@pebbl/types";
import { PeerConnection } from "../../src/network/connection.js";
import { initiateHandshake, acceptHandshake } from "../../src/network/handshake.js";
import { makeDuplexPair } from "../testHelpers.js";

function makeTestConfig(nodes: Record<string, string>): ClusterConfig {
  const nodeRecords: Record<string, { publicKey: string }> = {};
  for (const [id, pub] of Object.entries(nodes)) {
    nodeRecords[id] = { publicKey: pub };
  }

  return {
    clusterId: "test-cluster",
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

describe("3-way Challenge-Response Handshake", () => {
  it("completes valid handshake between two configured nodes", async () => {
    const idA = generateIdentity();
    const idB = generateIdentity();

    const config = makeTestConfig({
      [idA.nodeId]: idA.publicKeyHex,
      [idB.nodeId]: idB.publicKeyHex,
    });

    const [sockA, sockB] = makeDuplexPair();
    const connA = new PeerConnection(sockA);
    const connB = new PeerConnection(sockB);

    const [resA, resB] = await Promise.all([
      initiateHandshake(connA, idA, config),
      acceptHandshake(connB, idB, config),
    ]);

    expect(resA.remoteNodeId).toBe(idB.nodeId);
    expect(resB.remoteNodeId).toBe(idA.nodeId);
  });

  it("fails if clusterId does not match", async () => {
    const idA = generateIdentity();
    const idB = generateIdentity();

    const configA = makeTestConfig({
      [idA.nodeId]: idA.publicKeyHex,
      [idB.nodeId]: idB.publicKeyHex,
    });
    const configB = { ...configA, clusterId: "other-cluster" };

    const [sockA, sockB] = makeDuplexPair();
    const connA = new PeerConnection(sockA);
    const connB = new PeerConnection(sockB);

    await expect(
      Promise.all([
        initiateHandshake(connA, idA, configA),
        acceptHandshake(connB, idB, configB),
      ]),
    ).rejects.toThrow();
  });

  it("fails if connecting node is not in config", async () => {
    const idA = generateIdentity();
    const idB = generateIdentity();
    const idUnknown = generateIdentity();

    const config = makeTestConfig({
      [idA.nodeId]: idA.publicKeyHex,
      [idB.nodeId]: idB.publicKeyHex,
    });

    const [sockA, sockB] = makeDuplexPair();
    const connUnknown = new PeerConnection(sockA);
    const connB = new PeerConnection(sockB);

    await expect(
      Promise.all([
        initiateHandshake(connUnknown, idUnknown, config),
        acceptHandshake(connB, idB, config),
      ]),
    ).rejects.toThrow();
  });
});
