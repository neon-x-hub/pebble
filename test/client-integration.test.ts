import { describe, it, expect, afterEach } from "vitest";
import { PebbleClient } from "@pebbl/client";
import {
  generateClientKeypair,
  issueClientCredential,
} from "@pebbl/moderator";
import { PermissionDeniedError } from "@pebbl/types";
import { createTestCluster, sleep, type TestCluster } from "./helpers.js";

describe("Integration: Client Permissions across Multi-Node Cluster", () => {
  let cluster: TestCluster;

  afterEach(async () => {
    if (cluster) await cluster.close();
  });

  it("enforces client credentials and permissions across separate cluster nodes", async () => {
    cluster = await createTestCluster(2, { gossipIntervalMs: 80, pingIntervalMs: 150 });
    const nodeList = Array.from(cluster.nodes.values());
    const infoA = nodeList[0]!;
    const infoB = nodeList[1]!;

    // 1. Moderator issues read-write credential for Alice
    const aliceKeys = generateClientKeypair();
    const aliceCred = issueClientCredential({
      moderatorPrivateKeyHex: cluster.moderator.privateKeyHex,
      clientId: "alice",
      clientPublicKeyHex: aliceKeys.publicKeyHex,
      permissions: "read-write",
    });

    // 2. Moderator issues read-only credential for Bob
    const bobKeys = generateClientKeypair();
    const bobCred = issueClientCredential({
      moderatorPrivateKeyHex: cluster.moderator.privateKeyHex,
      clientId: "bob",
      clientPublicKeyHex: bobKeys.publicKeyHex,
      permissions: "read-only",
    });

    // 3. Alice connects to Node A, Bob connects to Node B
    const aliceClient = await PebbleClient.connect({
      host: "127.0.0.1",
      port: infoA.clientPort,
      credential: aliceCred,
      privateKeyHex: aliceKeys.privateKeyHex,
    });

    const bobClient = await PebbleClient.connect({
      host: "127.0.0.1",
      port: infoB.clientPort,
      credential: bobCred,
      privateKeyHex: bobKeys.privateKeyHex,
    });

    try {
      // Alice writes via Node A
      await aliceClient.put("shared-doc", "v1.0");

      // Wait for gossip to replicate from Node A to Node B
      await sleep(500);

      // Bob reads from Node B
      const doc = await bobClient.get("shared-doc");
      expect(doc).toBe("v1.0");

      const keys = await bobClient.keys();
      expect(keys).toContain("shared-doc");

      // Bob (read-only) attempts to write to Node B -> rejected
      await expect(bobClient.put("bob-doc", "evil")).rejects.toThrow(PermissionDeniedError);
      await expect(bobClient.delete("shared-doc")).rejects.toThrow(PermissionDeniedError);

      // Alice updates document to v2.0
      await aliceClient.put("shared-doc", "v2.0");
      await sleep(500);

      expect(await bobClient.get("shared-doc")).toBe("v2.0");
    } finally {
      await aliceClient.close();
      await bobClient.close();
    }
  });
});
