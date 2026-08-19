import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateConfig } from "../src/config.js";

describe("ClusterConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pebbl-cfg-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const validRawConfig = {
    clusterId: "test-cluster",
    moderatorPublicKey: "abcdef0123456789",
    nodes: {
      "node-a": { publicKey: "pub-a" },
      "node-b": { publicKey: "pub-b" },
    },
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

  it("validates valid config object", () => {
    const config = validateConfig(validRawConfig);
    expect(config.clusterId).toBe("test-cluster");
    expect(config.nodes["node-a"]?.publicKey).toBe("pub-a");
  });

  it("rejects config missing required fields", () => {
    expect(() => validateConfig({ ...validRawConfig, clusterId: "" })).toThrow();
    expect(() => validateConfig({ ...validRawConfig, nodes: {} })).toThrow();
  });

  it("loads and validates config file", async () => {
    const cfgPath = join(tmpDir, "cluster.json");
    await writeFile(cfgPath, JSON.stringify(validRawConfig), "utf8");

    const loaded = await loadConfig(cfgPath);
    expect(loaded.clusterId).toBe("test-cluster");
    expect(loaded.gossipPort).toBe(7000);
  });
});
