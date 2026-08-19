import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity, saveIdentity } from "@pebbl/crypto";
import { Pebble } from "@pebbl/node";
import type { Identity } from "@pebbl/types";

export interface TestClusterNode {
  nodeId: string;
  identity: Identity;
  dataDir: string;
  gossipPort: number;
  clientPort: number;
  pebble?: Pebble;
}

export interface TestCluster {
  nodes: Map<string, TestClusterNode>;
  moderator: Identity;
  baseDir: string;
  configPath: string;
  close: () => Promise<void>;
}

let nextPort = 10000 + Math.floor(Math.random() * 20000);

export async function createTestCluster(
  nodeCount: number,
  options?: {
    gossipIntervalMs?: number;
    pingIntervalMs?: number;
  },
): Promise<TestCluster> {
  const baseDir = await mkdtemp(join(tmpdir(), "pebbl-cluster-"));
  const moderator = generateIdentity();
  const clusterNodes = new Map<string, TestClusterNode>();

  const nodeIdentities: Identity[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const id = generateIdentity();
    const nodeDir = join(baseDir, `node-${i}`);
    await saveIdentity(nodeDir, id);

    const gossipPort = nextPort++;
    const clientPort = nextPort++;

    nodeIdentities.push(id);
    clusterNodes.set(id.nodeId, {
      nodeId: id.nodeId,
      identity: id,
      dataDir: nodeDir,
      gossipPort,
      clientPort,
    });
  }

  const nodesConfig: Record<string, { publicKey: string }> = {};
  for (const id of nodeIdentities) {
    nodesConfig[id.nodeId] = { publicKey: id.publicKeyHex };
  }

  const clusterConfig = {
    clusterId: "integration-test-cluster",
    moderatorPublicKey: moderator.publicKeyHex,
    nodes: nodesConfig,
    gossipIntervalMs: options?.gossipIntervalMs ?? 100,
    pingIntervalMs: options?.pingIntervalMs ?? 200,
    unhealthyThresholdMs: 5000,
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

  const configPath = join(baseDir, "cluster.json");
  await writeFile(configPath, JSON.stringify(clusterConfig, null, 2), "utf8");

  // Address resolver
  const addressResolver = (nodeId: string) => {
    const n = clusterNodes.get(nodeId);
    if (!n) return { host: "127.0.0.1", port: 7000 };
    return { host: "127.0.0.1", port: n.gossipPort };
  };

  // Launch nodes
  for (const [, n] of clusterNodes) {
    n.pebble = await Pebble.open({
      dataDir: n.dataDir,
      configPath,
      gossipPort: n.gossipPort,
      clientPort: n.clientPort,
      addressResolver,
    });
  }

  const close = async () => {
    for (const [, n] of clusterNodes) {
      if (n.pebble) {
        await n.pebble.close().catch(() => {});
      }
    }
    await rm(baseDir, { recursive: true, force: true }).catch(() => {});
  };

  return {
    nodes: clusterNodes,
    moderator,
    baseDir,
    configPath,
    close,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
