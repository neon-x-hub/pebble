import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "@pebbl/crypto";
import { Store } from "../../src/store/store.js";
import { MutationLog } from "../../src/persistence/log.js";
import { saveSnapshot } from "../../src/persistence/snapshot.js";
import { recover } from "../../src/persistence/recovery.js";
import { createMutation } from "../../src/store/mutation.js";

describe("Recovery pipeline", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pebbl-recover-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("recovers state from snapshot and subsequent log entries", async () => {
    const id = generateIdentity();

    // 1. Initial state -> take snapshot
    const m1 = createMutation({ identity: id, sequence: 1, operation: "put", key: "k1", value: "v1" });
    await saveSnapshot(tmpDir, new Map([["k1", m1]]), { [id.nodeId]: 1 }, 2);

    // 2. Further writes appended to log
    const log = new MutationLog(tmpDir);
    await log.open();
    const m2 = createMutation({ identity: id, sequence: 2, operation: "put", key: "k2", value: "v2" });
    await log.append(m2);
    await log.close();

    // 3. Recover in a fresh store
    const store = new Store(id.nodeId);
    const result = await recover(tmpDir, store, id.nodeId);

    expect(result.snapshotLoaded).toBe(true);
    expect(result.recoveredMutationsCount).toBe(1);
    expect(store.get("k1")).toBe("v1");
    expect(store.get("k2")).toBe("v2");
    expect(store.getNextLocalSequence()).toBe(3);
  });
});
