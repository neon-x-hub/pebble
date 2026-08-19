import { sign } from "node:crypto";
import {
  ClientMessageType,
  type ClientCredential,
  type ClientPermission,
  PermissionDeniedError,
  ValueTooLargeError,
  ProtocolError,
  UnauthorizedClientError,
  CredentialExpiredError,
} from "@pebbl/types";
import { privateKeyFromHex } from "@pebbl/crypto";
import type { Duplex } from "node:stream";
import { ClientConnection } from "./connection.js";

export interface PebbleClientOptions {
  host: string;
  port: number;
  credential: ClientCredential;
  privateKeyHex: string;
  timeoutMs?: number;
  socket?: Duplex; // optional in-memory socket for testing
}

export class PebbleClient {
  private requestCounter = 0;

  private constructor(
    private readonly conn: ClientConnection,
    public readonly permissions: ClientPermission,
    public readonly clientId: string,
  ) {}

  /**
   * Connect to a cluster node and complete the authentication handshake.
   */
  static async connect(options: PebbleClientOptions): Promise<PebbleClient> {
    const conn = options.socket
      ? new ClientConnection(options.socket)
      : await ClientConnection.connect(options.host, options.port);

    try {
      // 1. Wait for AUTH_CHALLENGE { nonce }
      const challengeFrame = await conn.receiveNext(options.timeoutMs ?? 10000);
      if (challengeFrame.type !== ClientMessageType.AUTH_CHALLENGE) {
        throw new ProtocolError(`Expected AUTH_CHALLENGE (0x10), got 0x${challengeFrame.type.toString(16)}`);
      }

      const nonce = String((challengeFrame.payload as Record<string, unknown>)["nonce"] || "");
      if (!nonce) {
        throw new ProtocolError("Received empty challenge nonce from node");
      }

      // 2. Sign the nonce with client private key
      const privKey = privateKeyFromHex(options.privateKeyHex);
      const nonce_sig = sign(null, Buffer.from(nonce, "utf8"), privKey).toString("hex");

      // 3. Send AUTH_RESPONSE
      await conn.send(ClientMessageType.AUTH_RESPONSE, {
        credential: options.credential,
        nonce_sig,
      });

      // 4. Wait for AUTH_ACK or ERROR
      const ackFrame = await conn.receiveNext(options.timeoutMs ?? 10000);
      if (ackFrame.type === ClientMessageType.ERROR) {
        const errPayload = ackFrame.payload as Record<string, unknown>;
        const msg = String(errPayload["message"] || "Authentication rejected");
        if (msg.includes("expired")) {
          throw new CredentialExpiredError(msg);
        }
        throw new UnauthorizedClientError(msg);
      }

      if (ackFrame.type !== ClientMessageType.AUTH_ACK) {
        throw new ProtocolError(`Expected AUTH_ACK (0x12), got 0x${ackFrame.type.toString(16)}`);
      }

      const permissions = (ackFrame.payload as Record<string, unknown>)["permissions"] as ClientPermission;

      return new PebbleClient(conn, permissions, options.credential.clientId);
    } catch (err: unknown) {
      await conn.close().catch(() => {});
      throw err;
    }
  }

  private nextRequestId(): string {
    return `req-${++this.requestCounter}-${Date.now()}`;
  }

  /**
   * Look up a key from the cluster node.
   * Returns undefined if the key does not exist or has been deleted.
   */
  async get(key: string): Promise<string | undefined> {
    const requestId = this.nextRequestId();
    const frame = await this.conn.request(ClientMessageType.GET_REQUEST, {
      requestId,
      key,
    });

    if (frame.type === ClientMessageType.ERROR) {
      this.handleServerError(frame.payload);
    }

    if (frame.type !== ClientMessageType.GET_RESPONSE) {
      throw new ProtocolError(`Expected GET_RESPONSE, got 0x${frame.type.toString(16)}`);
    }

    const payload = frame.payload as { found?: boolean; value?: string | null };
    return payload.found ? (payload.value ?? undefined) : undefined;
  }

  /**
   * List all currently live keys.
   */
  async keys(): Promise<string[]> {
    const requestId = this.nextRequestId();
    const frame = await this.conn.request(ClientMessageType.KEYS_REQUEST, {
      requestId,
    });

    if (frame.type === ClientMessageType.ERROR) {
      this.handleServerError(frame.payload);
    }

    if (frame.type !== ClientMessageType.KEYS_RESPONSE) {
      throw new ProtocolError(`Expected KEYS_RESPONSE, got 0x${frame.type.toString(16)}`);
    }

    const payload = frame.payload as { keys?: string[] };
    return payload.keys ?? [];
  }

  /**
   * List all currently live key-value entries.
   */
  async entries(): Promise<Array<[string, string]>> {
    const requestId = this.nextRequestId();
    const frame = await this.conn.request(ClientMessageType.ENTRIES_REQUEST, {
      requestId,
    });

    if (frame.type === ClientMessageType.ERROR) {
      this.handleServerError(frame.payload);
    }

    if (frame.type !== ClientMessageType.ENTRIES_RESPONSE) {
      throw new ProtocolError(`Expected ENTRIES_RESPONSE, got 0x${frame.type.toString(16)}`);
    }

    const payload = frame.payload as { entries?: Array<[string, string]> };
    return payload.entries ?? [];
  }

  /**
   * Write a key-value pair to the cluster.
   * Requires read-write permissions.
   */
  async put(key: string, value: string): Promise<void> {
    if (this.permissions !== "read-write") {
      throw new PermissionDeniedError("Cannot put: client has read-only permissions");
    }

    const requestId = this.nextRequestId();
    const frame = await this.conn.request(ClientMessageType.PUT_REQUEST, {
      requestId,
      key,
      value,
    });

    if (frame.type === ClientMessageType.ERROR) {
      this.handleServerError(frame.payload);
    }

    if (frame.type !== ClientMessageType.PUT_RESPONSE) {
      throw new ProtocolError(`Expected PUT_RESPONSE, got 0x${frame.type.toString(16)}`);
    }
  }

  /**
   * Delete a key from the cluster.
   * Requires read-write permissions.
   */
  async delete(key: string): Promise<void> {
    if (this.permissions !== "read-write") {
      throw new PermissionDeniedError("Cannot delete: client has read-only permissions");
    }

    const requestId = this.nextRequestId();
    const frame = await this.conn.request(ClientMessageType.DELETE_REQUEST, {
      requestId,
      key,
    });

    if (frame.type === ClientMessageType.ERROR) {
      this.handleServerError(frame.payload);
    }

    if (frame.type !== ClientMessageType.DELETE_RESPONSE) {
      throw new ProtocolError(`Expected DELETE_RESPONSE, got 0x${frame.type.toString(16)}`);
    }
  }

  /**
   * Close the client connection cleanly.
   */
  async close(): Promise<void> {
    await this.conn.close();
  }

  private handleServerError(payload: unknown): never {
    const p = (payload || {}) as Record<string, unknown>;
    const code = String(p["code"] || "");
    const message = String(p["message"] || "Unknown server error");

    if (code === "PERMISSION_DENIED") {
      throw new PermissionDeniedError(message);
    }
    if (code === "VALUE_TOO_LARGE") {
      throw new ValueTooLargeError(message);
    }
    throw new ProtocolError(`Server error (${code}): ${message}`);
  }
}
