import { createServer, type Server, type Socket } from "node:net";
import { EventEmitter } from "node:events";
import type { ClusterConfig, Identity } from "@pebbl/types";
import type { Store } from "@pebbl/core";
import { PeerConnection } from "../network/connection.js";
import { authenticateClient } from "./clientAuth.js";
import { handleClientFrame } from "./clientHandler.js";

export class ClientServer extends EventEmitter {
  private server: Server | null = null;
  private activeSockets = new Set<Socket>();

  constructor(
    private readonly identity: Identity,
    private readonly config: ClusterConfig,
    private readonly store: Store,
  ) {
    super();
  }

  /**
   * Start listening on clientPort.
   */
  async listen(port?: number): Promise<void> {
    const listenPort = port ?? this.config.clientPort;
    return new Promise((resolve, reject) => {
      this.server = createServer(async (socket: Socket) => {
        this.activeSockets.add(socket);
        socket.on("close", () => this.activeSockets.delete(socket));

        const conn = new PeerConnection(socket, this.config.limits.maxMessageBytes);
        try {
          const authClient = await authenticateClient(conn, this.config.moderatorPublicKey);

          // Handle incoming frames in a loop
          while (true) {
            try {
              const frame = await conn.receive(0); // wait indefinitely for next client request
              await handleClientFrame(
                conn,
                frame,
                authClient,
                this.store,
                this.identity,
                this.config,
              );
            } catch (err: unknown) {
              // Socket closed or broken
              break;
            }
          }
        } catch (err: unknown) {
          // Authentication failed or client disconnected during handshake
          this.emit("client:rejected", err);
        } finally {
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
   * Stop the client server and close all client connections.
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
