import { createServer, type Server, type Socket } from "node:net";
import { EventEmitter } from "node:events";
import type { ClusterConfig, Identity } from "@pebbl/types";
import { PeerConnection } from "./connection.js";
import { acceptHandshake, type HandshakeResult } from "./handshake.js";

export type { HandshakeResult };
export type PeerConnectionHandler = (
  connection: PeerConnection,
  handshake: HandshakeResult,
) => Promise<void>;

export class PebbleServer extends EventEmitter {
  private server: Server | null = null;
  private activeSockets = new Set<Socket>();

  constructor(
    private readonly identity: Identity,
    private readonly config: ClusterConfig,
    private readonly handler: PeerConnectionHandler,
  ) {
    super();
  }

  /**
   * Start listening on the gossip port.
   */
  async listen(port?: number): Promise<void> {
    const listenPort = port ?? this.config.gossipPort;
    return new Promise((resolve, reject) => {
      this.server = createServer(async (socket: Socket) => {
        this.activeSockets.add(socket);
        socket.on("close", () => this.activeSockets.delete(socket));

        const conn = new PeerConnection(socket, this.config.limits.maxMessageBytes);
        try {
          const handshake = await acceptHandshake(conn, this.identity, this.config);
          await this.handler(conn, handshake);
        } catch (err: unknown) {
          this.emit("peer:rejected", err);
          await conn.close().catch(() => {});
        }
      });

      this.server.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });

      this.server.listen(listenPort, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the server and close all active socket connections.
   */
  async close(): Promise<void> {
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
  }
}
