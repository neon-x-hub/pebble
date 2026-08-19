import { createConnection, type Socket } from "node:net";
import type { ClusterConfig, Identity } from "@pebbl/types";
import type { Store } from "@pebbl/core";
import { PeerConnection } from "../network/connection.js";
import { initiateHandshake } from "../network/handshake.js";
import type { PeerHealth } from "../health/health.js";
import type { PeerAddressResolver } from "../health/pinger.js";
import { runInitiatorSync, type SyncResult } from "./sync.js";

export interface GossipStats {
  roundsAttempted: number;
  roundsSuccessful: number;
  mutationsReceived: number;
  mutationsSent: number;
}

export class GossipEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stats: GossipStats = {
    roundsAttempted: 0,
    roundsSuccessful: 0,
    mutationsReceived: 0,
    mutationsSent: 0,
  };

  constructor(
    private readonly identity: Identity,
    private readonly config: ClusterConfig,
    private readonly store: Store,
    private readonly peerHealth: PeerHealth,
    private readonly addressResolver?: PeerAddressResolver,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getStats(): GossipStats {
    return { ...this.stats };
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.runRound();
      this.scheduleNext();
    }, this.config.gossipIntervalMs);
  }

  async runRound(): Promise<SyncResult | null> {
    const targetNodeId = this.peerHealth.selectGossipTarget();
    if (!targetNodeId) {
      return null;
    }

    this.stats.roundsAttempted++;
    const addr = this.addressResolver
      ? this.addressResolver(targetNodeId)
      : { host: "127.0.0.1", port: this.config.gossipPort };

    let socket: Socket | null = null;
    let conn: PeerConnection | null = null;

    try {
      socket = createConnection({ host: addr.host, port: addr.port });
      await new Promise<void>((resolve, reject) => {
        socket!.once("connect", () => resolve());
        socket!.once("error", (err) => reject(err));
      });

      conn = new PeerConnection(socket, this.config.limits.maxMessageBytes);
      await initiateHandshake(conn, this.identity, this.config);

      const start = Date.now();
      const syncResult = await runInitiatorSync(conn, this.store, this.config);
      const rtt = Date.now() - start;

      this.peerHealth.recordSuccess(targetNodeId, rtt);
      this.stats.roundsSuccessful++;
      this.stats.mutationsReceived += syncResult.mutationsReceived;
      this.stats.mutationsSent += syncResult.mutationsSent;

      return syncResult;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.peerHealth.recordFailure(targetNodeId, msg);
      return null;
    } finally {
      if (conn) {
        await conn.close().catch(() => {});
      } else if (socket) {
        socket.destroy();
      }
    }
  }
}
