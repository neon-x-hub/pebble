import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { encodeFrame, FrameDecoder, type Frame } from "@pebbl/wire";

export class PeerConnection extends EventEmitter {
  private readonly decoder: FrameDecoder;
  private readonly queue: Frame[] = [];
  private waiters: Array<{
    resolve: (frame: Frame) => void;
    reject: (err: Error) => void;
  }> = [];
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
          if (this.waiters.length > 0) {
            const waiter = this.waiters.shift()!;
            waiter.resolve(frame);
          } else {
            this.queue.push(frame);
          }
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

  /**
   * Send a framed message across the wire.
   */
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

  /**
   * Receive the next complete frame from the socket.
   */
  async receive(timeoutMs: number = 10000): Promise<Frame> {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    if (this.error) {
      throw this.error;
    }
    if (this.closed) {
      throw new Error("Connection closed before receiving frame");
    }

    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = this.waiters.findIndex((w) => w.resolve === waiter.resolve);
          if (idx !== -1) {
            this.waiters.splice(idx, 1);
          }
          reject(new Error(`Timed out waiting for frame after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      const waiter = {
        resolve: (f: Frame) => {
          if (timer) clearTimeout(timer);
          resolve(f);
        },
        reject: (err: Error) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      };

      this.waiters.push(waiter);
    });
  }

  /**
   * Close the connection cleanly.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.socket.destroy();
    this.handleClose();
  }

  private handleError(err: Error): void {
    this.error = err;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.reject(err);
    }
    this.emit("error", err);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    const closeErr = new Error("Connection closed");
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.reject(closeErr);
    }
    this.emit("close");
  }
}
