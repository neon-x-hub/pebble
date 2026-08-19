import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "@pebbl/crypto";
import { createMutation } from "../../src/store/mutation.js";
import { saveSnapshot, loadLatestSnapshot } from "../../src/persistence/snapshot.js";
import type { Mutation } from "@pebbl/types";

describe("Snapshot persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pebbl-snap-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null if no snapshots exist", async () => {
    const snap = await loadLatestSnapshot(tmpDir);
    expect(snap).toBeNull();
  });

  it("saves and loads the latest snapshot", async () => {
    const id = generateIdentity();
    const m = createMutation({ identity: id, sequence: 1, operation: "put", key: "k", value: "v" });

    const state = new Map<string, Mutation>([["k", m]]);
    const vector = { [id.nodeId]: 1 };

    const path = await saveSnapshot(tmpDir, state, vector, 2);
    expect(path).toContain(".snapshot.json");

    const loaded = await loadLatestSnapshot(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(1);
    expect(loaded?.nextLocalSequence).toBe(2);
    expect(loaded?.versionVector).toEqual(vector);
    expect(loaded?.state["k"]?.value).toBe("v");
  });
});
