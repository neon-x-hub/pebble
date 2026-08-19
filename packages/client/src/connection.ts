import { createConnection, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { EventEmitter } from "node:events";
import { encodeFrame, FrameDecoder, type Frame } from "@pebbl/wire";

export class ClientConnection extends EventEmitter {
  private readonly decoder: FrameDecoder;
  private readonly pendingRequests = new Map<string, {
    resolve: (frame: Frame) => void;
    reject: (err: Error) => void;
    timer?: NodeJS.Timeout;
  }>();
  private readonly anonymousWaiters: Array<{
    resolve: (frame: Frame) => void;
    reject: (err: Error) => void;
    timer?: NodeJS.Timeout;
  }> = [];
  private readonly anonymousQueue: Frame[] = [];

  private closed = false;
  private error: Error | null = null;

  constructor(
    public readonly socket: Duplex,
    maxMessageBytes: number = 10 * 1024 * 1024,
  ) {
    super();
    // Default no-op error handler to prevent unhandled EventEmitter error throws
    this.on("error", () => {});
    this.decoder = new FrameDecoder(maxMessageBytes);

    this.socket.on("data", (chunk: Buffer) => {
      try {
        const frames = this.decoder.push(chunk);
        for (const frame of frames) {
          this.dispatchFrame(frame);
        }
      } catch (err: unknown) {
        this.handleError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.socket.on("error", (err: Error) => {
      this.handleError(err);
    });

    this.socket.on("close", () => {
      this.handleClose();
    });

    this.socket.on("end", () => {
      this.handleClose();
    });
  }

  static async connect(
    host: string,
    port: number,
    maxMessageBytes: number = 10 * 1024 * 1024,
  ): Promise<ClientConnection> {
    const socket = createConnection({ host, port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", (err) => reject(err));
    });

    return new ClientConnection(socket, maxMessageBytes);
  }

  private dispatchFrame(frame: Frame): void {
    const payload = frame.payload as Record<string, unknown> | null;
    const requestId = payload && typeof payload["requestId"] === "string"
      ? payload["requestId"]
      : undefined;

    if (requestId && this.pendingRequests.has(requestId)) {
      const waiter = this.pendingRequests.get(requestId)!;
      this.pendingRequests.delete(requestId);
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return;
    }

    if (this.anonymousWaiters.length > 0) {
      const waiter = this.anonymousWaiters.shift()!;
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return;
    }

    this.anonymousQueue.push(frame);
  }

  async send(type: number, payload: unknown): Promise<void> {
    if (this.closed || this.error) {
      throw this.error || new Error("Connection is closed");
    }
    const frame = encodeFrame(type, payload);
    return new Promise((resolve, reject) => {
      this.socket.write(frame, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async receiveNext(timeoutMs: number = 10000): Promise<Frame> {
    if (this.anonymousQueue.length > 0) {
      return this.anonymousQueue.shift()!;
    }
    if (this.error) throw this.error;
    if (this.closed) throw new Error("Connection is closed");

    return new Promise((resolve, reject) => {
      const waiter: {
        resolve: (frame: Frame) => void;
        reject: (err: Error) => void;
        timer?: NodeJS.Timeout;
      } = { resolve, reject };

      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const idx = this.anonymousWaiters.indexOf(waiter);
          if (idx !== -1) {
            this.anonymousWaiters.splice(idx, 1);
          }
          reject(new Error(`Timed out waiting for frame after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      this.anonymousWaiters.push(waiter);
    });
  }

  async request(
    type: number,
    payload: { requestId: string; [key: string]: unknown },
    timeoutMs: number = 10000,
  ): Promise<Frame> {
    if (this.closed || this.error) {
      throw this.error || new Error("Connection is closed");
    }

    const frame = encodeFrame(type, payload);

    return new Promise((resolve, reject) => {
      const waiter: {
        resolve: (frame: Frame) => void;
        reject: (err: Error) => void;
        timer?: NodeJS.Timeout;
      } = { resolve, reject };

      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.pendingRequests.delete(payload.requestId);
          reject(new Error(`Request ${payload.requestId} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      this.pendingRequests.set(payload.requestId, waiter);

      this.socket.write(frame, (err) => {
        if (err) {
          if (waiter.timer) clearTimeout(waiter.timer);
          this.pendingRequests.delete(payload.requestId);
          reject(err);
        }
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    (this.socket as Socket).destroy?.();
    this.handleClose();
  }

  private handleError(err: Error): void {
    this.error = err;
    for (const [, waiter] of this.pendingRequests) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.pendingRequests.clear();

    for (const waiter of this.anonymousWaiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.anonymousWaiters.length = 0;

    this.emit("error", err);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    const closeErr = new Error("Connection closed");

    for (const [, waiter] of this.pendingRequests) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(closeErr);
    }
    this.pendingRequests.clear();

    for (const waiter of this.anonymousWaiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(closeErr);
    }
    this.anonymousWaiters.length = 0;

    this.emit("close");
  }
}
