import { open, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { Mutation } from "@pebbl/types";
import { validateMutationStructure } from "../store/mutation.js";

const LOG_FILE = "mutations.log";

/**
 * Append-only NDJSON mutation log.
 *
 * Each mutation is serialized to a single line of compact JSON followed by a newline.
 * On recovery, lines are read sequentially. Corrupted tail lines (e.g. from an abrupt crash)
 * are skipped, and all valid mutations are returned.
 */
export class MutationLog {
  private handle: FileHandle | null = null;

  constructor(private readonly dataDir: string) {}

  /**
   * Open the log file for appending. Creates dataDir and log file if they don't exist.
   */
  async open(): Promise<void> {
    if (this.handle) return;
    await mkdir(this.dataDir, { recursive: true });
    this.handle = await open(join(this.dataDir, LOG_FILE), "a+");
  }

  /**
   * Append a mutation to the log and fsync to ensure durability.
   */
  async append(mutation: Mutation): Promise<void> {
    if (!this.handle) {
      throw new Error("MutationLog is not open");
    }
    const line = JSON.stringify(mutation) + "\n";
    await this.handle.write(line, null, "utf8");
    await this.handle.sync();
  }

  /**
   * Read all valid mutations from the log file.
   * Tolerates and skips corrupted lines at the tail.
   */
  async readAll(): Promise<Mutation[]> {
    await mkdir(this.dataDir, { recursive: true });
    let readHandle: FileHandle | null = null;
    try {
      readHandle = await open(join(this.dataDir, LOG_FILE), "r");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }

    try {
      const content = await readHandle.readFile({ encoding: "utf8" });
      const lines = content.split("\n");
      const mutations: Mutation[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;

        try {
          const parsed = JSON.parse(line);
          const mutation = validateMutationStructure(parsed);
          mutations.push(mutation);
        } catch {
          // If corrupted line encountered, skip it (corrupted tail from abrupt crash)
          continue;
        }
      }

      return mutations;
    } finally {
      await readHandle.close();
    }
  }

  /**
   * Close the log file handle.
   */
  async close(): Promise<void> {
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
  }
}
