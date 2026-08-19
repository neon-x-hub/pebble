import { describe, it, expect, afterEach } from "vitest";
import { Pebble } from "@pebbl/node";
import { createTestCluster, sleep, type TestCluster } from "./helpers.js";

describe("Integration: Crash Recovery & Cluster Catchup", () => {
  let cluster: TestCluster;

  afterEach(async () => {
    if (cluster) await cluster.close();
  });

  it("reconstructs state after restart and syncs missed updates from peers", async () => {
    cluster = await createTestCluster(2, { gossipIntervalMs: 80, pingIntervalMs: 150 });
    const nodeList = Array.from(cluster.nodes.values());
    const infoA = nodeList[0]!;
    const infoB = nodeList[1]!;

    let nodeA = infoA.pebble!;
    const nodeB = infoB.pebble!;

    // 1. Node A writes keys
    for (let i = 0; i < 5; i++) {
      await nodeA.put(`persisted-${i}`, `val-${i}`);
    }

    // Take snapshot on Node A
    await nodeA.snapshot();

    // Node A writes 2 more keys to the log
    await nodeA.put("tail-1", "tail-val-1");
    await nodeA.put("tail-2", "tail-val-2");

    // Wait for B to receive initial writes
    await sleep(400);

    // 2. Shut down Node A
    await nodeA.close();
    infoA.pebble = undefined;

    // 3. Node B writes while Node A is offline
    await nodeB.put("while-a-offline", "offline-val");

    // 4. Reopen Node A from same dataDir
    const addressResolver = (nid: string) => {
      const target = cluster.nodes.get(nid);
      return { host: "127.0.0.1", port: target ? target.gossipPort : 7000 };
    };

    nodeA = await Pebble.open({
      dataDir: infoA.dataDir,
      configPath: cluster.configPath,
      gossipPort: infoA.gossipPort,
      clientPort: infoA.clientPort,
      addressResolver,
    });
    infoA.pebble = nodeA;

    // Node A should have its local state immediately from recovery
    expect(await nodeA.get("persisted-0")).toBe("val-0");
    expect(await nodeA.get("tail-1")).toBe("tail-val-1");
    expect(await nodeA.get("tail-2")).toBe("tail-val-2");

    // 5. Allow gossip to catch up
    await sleep(600);

    // Node A has caught up on the write that happened while it was offline
    expect(await nodeA.get("while-a-offline")).toBe("offline-val");

    const entriesA = await nodeA.entries();
    const entriesB = await nodeB.entries();
    expect(entriesA.sort()).toEqual(entriesB.sort());
  });
});
