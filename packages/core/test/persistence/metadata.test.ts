import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMetadata, saveMetadata } from "../../src/persistence/metadata.js";

describe("Metadata persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pebbl-meta-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns default metadata if file does not exist", async () => {
    const meta = await loadMetadata(tmpDir);
    expect(meta.nextLocalSequence).toBe(1);
    expect(meta.versionVector).toEqual({});
  });

  it("saves and loads metadata atomically", async () => {
    await saveMetadata(tmpDir, {
      nextLocalSequence: 42,
      versionVector: { "node-1": 10, "node-2": 5 },
    });

    const loaded = await loadMetadata(tmpDir);
    expect(loaded.nextLocalSequence).toBe(42);
    expect(loaded.versionVector).toEqual({ "node-1": 10, "node-2": 5 });
  });
});
