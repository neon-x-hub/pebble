import { MessageTooLargeError, ProtocolError } from "@pebbl/types";
import { HEADER_SIZE } from "./encode.js";

/**
 * A fully decoded wire frame.
 */
export interface Frame {
  /** The raw message type byte. */
  type: number;
  /** The parsed JSON payload. */
  payload: unknown;
}

/**
 * Stateful streaming frame decoder.
 *
 * TCP is a stream protocol — data arrives in arbitrary-sized chunks. This
 * decoder accumulates chunks until it has a complete frame, then emits it.
 * Multiple frames may arrive in a single chunk; partial frames may span
 * many chunks.
 *
 * Usage:
 * ```ts
 * const decoder = new FrameDecoder(10 * 1024 * 1024); // 10 MB limit
 * socket.on("data", (chunk: Buffer) => {
 *   const frames = decoder.push(chunk);
 *   for (const frame of frames) {
 *     handleMessage(frame.type, frame.payload);
 *   }
 * });
 * ```
 *
 * Thread safety: not required — Node.js event loop is single-threaded.
 */
export class FrameDecoder {
  /**
   * Internal accumulation buffer. We keep a list of chunks and a running
   * total byte count rather than concatenating eagerly, to avoid O(n²)
   * copy behaviour on high-throughput connections.
   */
  private chunks: Buffer[] = [];
  private totalBytes = 0;

  /**
   * @param maxMessageBytes - Frames whose declared body length exceeds this
   *   value are rejected with `MessageTooLargeError`.
   */
  constructor(private readonly maxMessageBytes: number) {}

  /**
   * Feed a new chunk of data into the decoder.
   *
   * @returns All complete frames that were decoded from the accumulated buffer.
   *          May be zero frames (partial data), one, or many.
   * @throws MessageTooLargeError if a frame's declared body size exceeds `maxMessageBytes`
   * @throws ProtocolError if a frame's JSON body cannot be parsed
   */
  push(chunk: Buffer): Frame[] {
    this.chunks.push(chunk);
    this.totalBytes += chunk.byteLength;
    return this.drain();
  }

  /**
   * Reset decoder state. Call if the connection is closed or errored.
   */
  reset(): void {
    this.chunks = [];
    this.totalBytes = 0;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Attempt to decode as many complete frames as possible from the accumulated
   * buffer. Returns them all; leaves any partial trailing data in place.
   */
  private drain(): Frame[] {
    const frames: Frame[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Need at least HEADER_SIZE bytes to read the length + type
      if (this.totalBytes < HEADER_SIZE) break;

      // Peek at the first 5 bytes to read the header without consuming yet
      const header = this.peek(HEADER_SIZE);
      const bodyLength = header.readUInt32BE(0);
      const type = header.readUInt8(4);

      if (bodyLength > this.maxMessageBytes) {
        throw new MessageTooLargeError(
          `Incoming frame body length ${bodyLength} exceeds limit ${this.maxMessageBytes}`,
        );
      }

      const totalFrameSize = HEADER_SIZE + bodyLength;
      if (this.totalBytes < totalFrameSize) {
        // Not enough data yet — wait for more chunks
        break;
      }

      // Consume exactly one complete frame
      this.consume(HEADER_SIZE); // discard header bytes
      const bodyBuffer = this.consume(bodyLength);

      let payload: unknown;
      try {
        payload = JSON.parse(bodyBuffer.toString("utf8"));
      } catch (err) {
        throw new ProtocolError(
          `Failed to parse frame body as JSON: ${String(err)}`,
        );
      }

      frames.push({ type, payload });
    }

    return frames;
  }

  /**
   * Read `n` bytes from the front of the buffer without consuming them.
   * Only safe to call when `this.totalBytes >= n`.
   */
  private peek(n: number): Buffer {
    return this.slice(n, false);
  }

  /**
   * Read and remove `n` bytes from the front of the buffer.
   * Only safe to call when `this.totalBytes >= n`.
   */
  private consume(n: number): Buffer {
    return this.slice(n, true);
  }

  private slice(n: number, consume: boolean): Buffer {
    // Fast path: all data is in the first chunk
    const first = this.chunks[0];
    if (first !== undefined && first.byteLength >= n) {
      const result = Buffer.from(first.subarray(0, n)); // always copy — safe for both peek and consume
      if (consume) {
        if (first.byteLength === n) {
          this.chunks.shift();
        } else {
          this.chunks[0] = first.subarray(n);
        }
        this.totalBytes -= n;
      }
      return result;
    }

    // Slow path: data spans multiple chunks — must copy into a contiguous buffer
    const result = Buffer.allocUnsafe(n);
    let written = 0;
    let remaining = n;
    let chunkIdx = 0;
    let offsetInChunk = 0; // tracks how far into the current chunk we've consumed

    // We need to walk chunks without mutating for peek, or mutating for consume
    const chunksCopy = consume ? this.chunks : this.chunks.map((c) => Buffer.from(c));

    while (remaining > 0 && chunkIdx < chunksCopy.length) {
      const chunk = chunksCopy[chunkIdx]!;
      const available = chunk.byteLength - offsetInChunk;
      const take = Math.min(available, remaining);
      chunk.copy(result, written, offsetInChunk, offsetInChunk + take);
      written += take;
      remaining -= take;

      if (consume) {
        if (take === available) {
          chunksCopy.shift(); // chunkIdx stays 0
        } else {
          chunksCopy[0] = chunk.subarray(offsetInChunk + take);
        }
      } else {
        offsetInChunk += take;
        if (offsetInChunk >= chunk.byteLength) {
          chunkIdx++;
          offsetInChunk = 0;
        }
      }
    }

    if (consume) {
      this.chunks = chunksCopy;
      this.totalBytes -= n;
    }

    return result;
  }
}
