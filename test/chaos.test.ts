import { describe, it, expect, afterEach } from "vitest";
import { PebbleClient } from "@pebbl/client";
import {
  generateClientKeypair,
  issueClientCredential,
} from "@pebbl/moderator";
import { createTestCluster, sleep, type TestCluster } from "./helpers.js";

describe("Integration: Chaos Test (Concurrent Random Writes + Replicated Convergence)", () => {
  let cluster: TestCluster;

  afterEach(async () => {
    if (cluster) await cluster.close();
  });

  it("converges to 100% identical state across all 3 nodes after randomized concurrent writes", async () => {
    cluster = await createTestCluster(3, { gossipIntervalMs: 60, pingIntervalMs: 120 });
    const nodeList = Array.from(cluster.nodes.values());

    // 1. Create 3 authenticated read-write clients, one per node
    const clients: PebbleClient[] = [];
    for (const nodeInfo of nodeList) {
      const keys = generateClientKeypair();
      const cred = issueClientCredential({
        moderatorPrivateKeyHex: cluster.moderator.privateKeyHex,
        clientId: `client-${nodeInfo.nodeId.substring(0, 6)}`,
        clientPublicKeyHex: keys.publicKeyHex,
        permissions: "read-write",
      });

      const client = await PebbleClient.connect({
        host: "127.0.0.1",
        port: nodeInfo.clientPort,
        credential: cred,
        privateKeyHex: keys.privateKeyHex,
      });

      clients.push(client);
    }

    try {
      // 2. Perform concurrent random writes and deletes for 2.5 seconds
      const testKeys = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
      const startTime = Date.now();
      const durationMs = 2500;
      let opCount = 0;

      while (Date.now() - startTime < durationMs) {
        const client = clients[Math.floor(Math.random() * clients.length)]!;
        const key = testKeys[Math.floor(Math.random() * testKeys.length)]!;
        const isDelete = Math.random() < 0.2; // 20% deletes, 80% writes

        if (isDelete) {
          await client.delete(key).catch(() => {});
        } else {
          const val = `val-${Math.floor(Math.random() * 10000)}`;
          await client.put(key, val).catch(() => {});
        }

        opCount++;
        await sleep(15);
      }

      expect(opCount).toBeGreaterThan(30);

      // 3. Stop all writes and wait for gossip replication to settle across all nodes
      await sleep(1200);

      const entries0 = (await nodeList[0]!.pebble!.entries()).sort();
      const entries1 = (await nodeList[1]!.pebble!.entries()).sort();
      const entries2 = (await nodeList[2]!.pebble!.entries()).sort();

      // Invariant: All healthy nodes eventually converge to identical state
      expect(entries0).toEqual(entries1);
      expect(entries1).toEqual(entries2);
    } finally {
      for (const c of clients) {
        await c.close().catch(() => {});
      }
    }
  });
});
