import { createConnection, type Socket } from "node:net";
import { GossipMessageType, type ClusterConfig, type Identity } from "@pebbl/types";
import { PeerConnection } from "../network/connection.js";
import { initiateHandshake } from "../network/handshake.js";
import type { PeerHealth } from "./health.js";

export type PeerAddressResolver = (nodeId: string) => { host: string; port: number };

export class Pinger {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly identity: Identity,
    private readonly config: ClusterConfig,
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

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.probeAll();
      this.scheduleNext();
    }, this.config.pingIntervalMs);
  }

  async probeAll(): Promise<void> {
    const peerNodeIds = Object.keys(this.config.nodes).filter(
      (nid) => nid !== this.identity.nodeId,
    );

    await Promise.allSettled(peerNodeIds.map((nid) => this.probePeer(nid)));
  }

  async probePeer(nodeId: string): Promise<void> {
    const addr = this.addressResolver
      ? this.addressResolver(nodeId)
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
      await conn.send(GossipMessageType.PING, { timestamp: start });

      const pongFrame = await conn.receive(5000);
      if (pongFrame.type !== GossipMessageType.PONG) {
        throw new Error(`Expected PONG, got 0x${pongFrame.type.toString(16)}`);
      }

      const rtt = Date.now() - start;
      this.peerHealth.recordSuccess(nodeId, rtt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.peerHealth.recordFailure(nodeId, msg);
    } finally {
      if (conn) {
        await conn.close().catch(() => {});
      } else if (socket) {
        socket.destroy();
      }
    }
  }
}
