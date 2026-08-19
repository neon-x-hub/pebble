import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "@pebbl/crypto";
import { Pebble } from "../src/pebble.js";

describe("Pebble runtime", () => {
  let tmpDir: string;
  let cfgPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pebbl-node-test-"));
    cfgPath = join(tmpDir, "cluster.json");

    const id = generateIdentity();
    const config = {
      clusterId: "runtime-cluster",
      moderatorPublicKey: "mod-key",
      nodes: {
        [id.nodeId]: { publicKey: id.publicKeyHex },
      },
      gossipIntervalMs: 10000,
      pingIntervalMs: 10000,
      unhealthyThresholdMs: 30000,
      gossipPort: 7890,
      clientPort: 7891,
      limits: {
        maxMessageBytes: 10485760,
        maxMutationsPerMessage: 500,
        maxRangesPerRequest: 100,
        maxKeyBytes: 1024,
        maxValueBytes: 1048576,
      },
    };

    await writeFile(cfgPath, JSON.stringify(config), "utf8");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("opens, performs CRUD operations, takes snapshots, and closes cleanly", async () => {
    const node = await Pebble.open({
      dataDir: tmpDir,
      configPath: cfgPath,
    });

    try {
      expect(await node.get("color")).toBeUndefined();
      expect(await node.has("color")).toBe(false);

      await node.put("color", "emerald");
      expect(await node.get("color")).toBe("emerald");
      expect(await node.has("color")).toBe(true);

      const keys = await node.keys();
      expect(keys).toEqual(["color"]);

      const entries = await node.entries();
      expect(entries).toEqual([["color", "emerald"]]);

      const snapPath = await node.snapshot();
      expect(snapPath).toContain(".snapshot.json");

      const stats = node.stats();
      expect(stats.keysCount).toBe(1);

      await node.delete("color");
      expect(await node.get("color")).toBeUndefined();
      expect((await node.keys()).length).toBe(0);
    } finally {
      await node.close();
    }
  });
});
