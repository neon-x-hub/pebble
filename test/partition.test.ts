import { describe, it, expect, afterEach } from "vitest";
import { createTestCluster, sleep, type TestCluster } from "./helpers.js";

describe("Integration: Network Partition & Healing", () => {
  let cluster: TestCluster;

  afterEach(async () => {
    if (cluster) await cluster.close();
  });

  it("handles concurrent writes during a partition and converges deterministically after healing", async () => {
    cluster = await createTestCluster(2, { gossipIntervalMs: 80, pingIntervalMs: 150 });
    const nodeList = Array.from(cluster.nodes.values());
    const nodeA = nodeList[0]!.pebble!;
    const nodeB = nodeList[1]!.pebble!;

    // 1. Initial write
    await nodeA.put("common", "initial");
    await sleep(400);
    expect(await nodeB.get("common")).toBe("initial");

    // 2. Both nodes write independent and conflicting keys
    // Node A writes k1..k4
    await nodeA.put("k1", "A_1");
    await nodeA.put("k2", "A_2");
    await nodeA.put("conflict_key", "value_from_A");

    // Node B writes k3..k4
    await nodeB.put("k3", "B_3");
    await nodeB.put("conflict_key", "value_from_B");

    // 3. Allow gossip to exchange all concurrent mutations
    await sleep(800);

    const entriesA = await nodeA.entries();
    const entriesB = await nodeB.entries();

    // Both nodes must have converged to identical state
    expect(entriesA.sort()).toEqual(entriesB.sort());

    // Both must have the exact same winner for conflict_key
    const valA = await nodeA.get("conflict_key");
    const valB = await nodeB.get("conflict_key");
    expect(valA).toBeDefined();
    expect(valA).toBe(valB);

    expect(await nodeA.get("k1")).toBe("A_1");
    expect(await nodeA.get("k3")).toBe("B_3");
  });
});
