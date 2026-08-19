import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { VersionVector } from "@pebbl/types";

const METADATA_FILE = "metadata.json";
const METADATA_TMP_FILE = "metadata.json.tmp";

export interface Metadata {
  nextLocalSequence: number;
  versionVector: VersionVector;
}

/**
 * Save node metadata atomically (write to .tmp then rename).
 */
export async function saveMetadata(dataDir: string, metadata: Metadata): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const uniqueId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpPath = join(dataDir, `metadata.${uniqueId}.tmp`);
  const finalPath = join(dataDir, METADATA_FILE);

  const content = JSON.stringify(metadata, null, 2);
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, finalPath);
}

/**
 * Load node metadata from disk. Returns default initial metadata if file does not exist.
 */
export async function loadMetadata(dataDir: string): Promise<Metadata> {
  const filePath = join(dataDir, METADATA_FILE);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.nextLocalSequence !== "number" ||
      typeof parsed.versionVector !== "object" ||
      parsed.versionVector === null
    ) {
      throw new Error(`Malformed metadata file at ${filePath}`);
    }

    return {
      nextLocalSequence: parsed.nextLocalSequence,
      versionVector: parsed.versionVector,
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        nextLocalSequence: 1,
        versionVector: {},
      };
    }
    throw err;
  }
}
