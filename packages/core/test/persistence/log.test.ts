import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MutationLog } from "../../src/persistence/log.js";
import { generateIdentity } from "@pebbl/crypto";
import { createMutation } from "../../src/store/mutation.js";

describe("MutationLog", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pebbl-log-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("appends and reads all mutations", async () => {
    const log = new MutationLog(tmpDir);
    await log.open();

    const id = generateIdentity();
    const m1 = createMutation({ identity: id, sequence: 1, operation: "put", key: "k1", value: "v1" });
    const m2 = createMutation({ identity: id, sequence: 2, operation: "put", key: "k2", value: "v2" });

    await log.append(m1);
    await log.append(m2);
    await log.close();

    const readLog = new MutationLog(tmpDir);
    const read = await readLog.readAll();
    expect(read).toHaveLength(2);
    expect(read[0]?.key).toBe("k1");
    expect(read[1]?.key).toBe("k2");
  });

  it("recovers gracefully from corrupted trailing lines", async () => {
    const log = new MutationLog(tmpDir);
    await log.open();

    const id = generateIdentity();
    const m1 = createMutation({ identity: id, sequence: 1, operation: "put", key: "k1", value: "v1" });
    await log.append(m1);
    await log.close();

    // Corrupt the log tail
    await appendFile(join(tmpDir, "mutations.log"), "{\"corrupted\": true, half_wri\n", "utf8");

    const readLog = new MutationLog(tmpDir);
    const read = await readLog.readAll();
    expect(read).toHaveLength(1);
    expect(read[0]?.key).toBe("k1");
  });

  it("returns empty array if log file does not exist", async () => {
    const log = new MutationLog(tmpDir);
    const read = await log.readAll();
    expect(read).toEqual([]);
  });
});
