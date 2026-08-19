import { describe, it, expect, afterEach } from "vitest";
import { createTestCluster, sleep, type TestCluster } from "./helpers.js";

describe("Integration: 3-Node Cluster Convergence", () => {
  let cluster: TestCluster;

  afterEach(async () => {
    if (cluster) await cluster.close();
  });

  it("propagates writes from one node to all other nodes in the cluster", async () => {
    cluster = await createTestCluster(3, { gossipIntervalMs: 80, pingIntervalMs: 150 });
    const nodeList = Array.from(cluster.nodes.values());
    const nodeA = nodeList[0]!.pebble!;
    const nodeB = nodeList[1]!.pebble!;
    const nodeC = nodeList[2]!.pebble!;

    // Node A writes 20 keys
    for (let i = 0; i < 20; i++) {
      await nodeA.put(`key-${i}`, `val-${i}`);
    }

    // Wait for gossip cycles to replicate data
    await sleep(600);

    const entriesA = await nodeA.entries();
    const entriesB = await nodeB.entries();
    const entriesC = await nodeC.entries();

    expect(entriesA.length).toBe(20);
    expect(entriesB.sort()).toEqual(entriesA.sort());
    expect(entriesC.sort()).toEqual(entriesA.sort());
  });
});
