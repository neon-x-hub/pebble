import type {
  ClusterConfig,
  Identity,
  Mutation,
  PeerInfo,
  VersionVector,
} from "@pebbl/types";
import {
  GossipMessageType,
} from "@pebbl/types";
import {
  loadIdentity,
  generateIdentity,
  saveIdentity,
} from "@pebbl/crypto";
import {
  Store,
  MutationLog,
  recover,
  saveMetadata,
  saveSnapshot,
  loadConfig,
} from "@pebbl/core";
import { PeerConnection } from "./network/connection.js";
import { PebbleServer, type HandshakeResult } from "./network/server.js";
import { PeerHealth } from "./health/health.js";
import { Pinger, type PeerAddressResolver } from "./health/pinger.js";
import { GossipEngine, type GossipStats } from "./gossip/engine.js";
import { handleResponderSync } from "./gossip/sync.js";
import { ClientServer } from "./clientServer/clientServer.js";

export interface PebbleOptions {
  dataDir: string;
  configPath: string;
  gossipPort?: number | undefined;
  clientPort?: number | undefined;
  addressResolver?: PeerAddressResolver | undefined;
}

export interface NodeStats {
  nodeId: string;
  gossip: GossipStats;
  versionVector: VersionVector;
  keysCount: number;
}

export class Pebble {
  private constructor(
    public readonly identity: Identity,
    public readonly config: ClusterConfig,
    public readonly store: Store,
    private readonly log: MutationLog,
    private readonly pebbleServer: PebbleServer,
    private readonly clientServer: ClientServer,
    private readonly peerHealth: PeerHealth,
    private readonly pinger: Pinger,
    private readonly gossipEngine: GossipEngine,
    private readonly dataDir: string,
  ) {}

  static async open(options: PebbleOptions): Promise<Pebble> {
    const config = await loadConfig(options.configPath);

    // 1. Identity setup
    let identity: Identity;
    try {
      identity = await loadIdentity(options.dataDir);
    } catch {
      identity = generateIdentity();
      await saveIdentity(options.dataDir, identity);
    }

    // 2. Store & Recovery
    const store = new Store(identity.nodeId);
    await recover(options.dataDir, store, identity.nodeId);

    // 3. MutationLog & Metadata sync
    const log = new MutationLog(options.dataDir);
    await log.open();

    store.on("mutation:applied", (m: Mutation) => {
      // Async write to disk
      log.append(m).catch(() => {});
      saveMetadata(options.dataDir, {
        nextLocalSequence: store.getNextLocalSequence(),
        versionVector: store.getVersionVector(),
      }).catch(() => {});
    });

    // 4. Peer health, pinger & gossip
    const peerHealth = new PeerHealth(
      identity.nodeId,
      Object.keys(config.nodes),
      config.unhealthyThresholdMs,
    );

    const pinger = new Pinger(identity, config, peerHealth, options.addressResolver);
    const gossipEngine = new GossipEngine(
      identity,
      config,
      store,
      peerHealth,
      options.addressResolver,
    );

    // 5. PebbleServer (Gossip port)
    const handlePeer = async (conn: PeerConnection, _handshake: HandshakeResult) => {
      try {
        const frame = await conn.receive();
        if (frame.type === GossipMessageType.PING) {
          await conn.send(GossipMessageType.PONG, { timestamp: Date.now() });
        } else if (frame.type === GossipMessageType.DIGEST) {
          await handleResponderSync(conn, store, config, frame);
        }
      } finally {
        await conn.close().catch(() => {});
      }
    };

    const pebbleServer = new PebbleServer(identity, config, handlePeer);
    await pebbleServer.listen(options.gossipPort ?? config.gossipPort);

    pinger.start();
    gossipEngine.start();

    // 6. ClientServer (Client port)
    const clientServer = new ClientServer(identity, config, store);
    await clientServer.listen(options.clientPort ?? config.clientPort);

    return new Pebble(
      identity,
      config,
      store,
      log,
      pebbleServer,
      clientServer,
      peerHealth,
      pinger,
      gossipEngine,
      options.dataDir,
    );
  }

  // ---------------------------------------------------------------------------
  // Local CRUD operations
  // ---------------------------------------------------------------------------

  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async keys(): Promise<string[]> {
    return this.store.keys();
  }

  async entries(): Promise<Array<[string, string]>> {
    return this.store.entries();
  }

  async put(key: string, value: string): Promise<void> {
    const mutation = this.store.localPut(key, value, this.identity);
    await this.log.append(mutation);
    await saveMetadata(this.dataDir, {
      nextLocalSequence: this.store.getNextLocalSequence(),
      versionVector: this.store.getVersionVector(),
    });
  }

  async delete(key: string): Promise<void> {
    const mutation = this.store.localDelete(key, this.identity);
    await this.log.append(mutation);
    await saveMetadata(this.dataDir, {
      nextLocalSequence: this.store.getNextLocalSequence(),
      versionVector: this.store.getVersionVector(),
    });
  }

  // ---------------------------------------------------------------------------
  // Maintenance & Observability
  // ---------------------------------------------------------------------------

  async snapshot(): Promise<string> {
    return saveSnapshot(
      this.dataDir,
      this.store.exportState(),
      this.store.getVersionVector(),
      this.store.getNextLocalSequence(),
    );
  }

  stats(): NodeStats {
    return {
      nodeId: this.identity.nodeId,
      gossip: this.gossipEngine.getStats(),
      versionVector: this.store.getVersionVector(),
      keysCount: this.store.keys().length,
    };
  }

  peers(): PeerInfo[] {
    return this.peerHealth.getAllPeerInfo();
  }

  async close(): Promise<void> {
    this.pinger.stop();
    this.gossipEngine.stop();
    await this.clientServer.close();
    await this.pebbleServer.close();
    await this.log.close();
  }
}
