import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Mutation, VersionVector } from "@pebbl/types";
import { validateMutationStructure } from "../store/mutation.js";

const SNAPSHOTS_DIR = "snapshots";

export interface SnapshotData {
  version: number;
  createdAt: number;
  versionVector: VersionVector;
  nextLocalSequence: number;
  state: Record<string, Mutation>;
}

/**
 * Generate a snapshot filename with ISO-like timestamp safe for filesystems.
 */
function generateSnapshotFilename(createdAt: number): string {
  const dateStr = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
  return `${dateStr}.snapshot.json`;
}

/**
 * Save a snapshot of the current state and version vector.
 * Returns the path to the written snapshot file.
 */
export async function saveSnapshot(
  dataDir: string,
  state: ReadonlyMap<string, Mutation>,
  versionVector: Readonly<VersionVector>,
  nextLocalSequence: number,
): Promise<string> {
  const dir = join(dataDir, SNAPSHOTS_DIR);
  await mkdir(dir, { recursive: true });

  const createdAt = Date.now();
  const filename = generateSnapshotFilename(createdAt);
  const filePath = join(dir, filename);

  const stateRecord: Record<string, Mutation> = {};
  for (const [key, mutation] of state) {
    stateRecord[key] = mutation;
  }

  const snapshot: SnapshotData = {
    version: 1,
    createdAt,
    versionVector: { ...versionVector },
    nextLocalSequence,
    state: stateRecord,
  };

  await writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  return filePath;
}

/**
 * Load the latest snapshot from `{dataDir}/snapshots/`.
 * Returns null if no snapshots exist.
 */
export async function loadLatestSnapshot(dataDir: string): Promise<SnapshotData | null> {
  const dir = join(dataDir, SNAPSHOTS_DIR);
  try {
    const entries = await readdir(dir);
    const snapshotFiles = entries
      .filter((f) => f.endsWith(".snapshot.json"))
      .sort(); // Lexicographical sort corresponds to chronological ordering

    if (snapshotFiles.length === 0) {
      return null;
    }

    const latestFile = snapshotFiles[snapshotFiles.length - 1]!;
    const filePath = join(dir, latestFile);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.version !== "number" ||
      typeof parsed.versionVector !== "object" ||
      parsed.versionVector === null ||
      typeof parsed.state !== "object" ||
      parsed.state === null
    ) {
      throw new Error(`Malformed snapshot file at ${filePath}`);
    }

    const stateMap: Record<string, Mutation> = {};
    for (const [k, v] of Object.entries(parsed.state)) {
      stateMap[k] = validateMutationStructure(v);
    }

    return {
      version: parsed.version,
      createdAt: parsed.createdAt ?? Date.now(),
      versionVector: parsed.versionVector,
      nextLocalSequence: parsed.nextLocalSequence ?? 1,
      state: stateMap,
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}
