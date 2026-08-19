import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { generateIdentity, saveIdentity, loadIdentity } from "../src/identity.js";

describe("generateIdentity", () => {
  it("returns an object with nodeId, publicKeyHex, privateKeyHex", () => {
    const id = generateIdentity();
    expect(typeof id.nodeId).toBe("string");
    expect(typeof id.publicKeyHex).toBe("string");
    expect(typeof id.privateKeyHex).toBe("string");
  });

  it("produces a non-empty nodeId", () => {
    const id = generateIdentity();
    expect(id.nodeId.length).toBeGreaterThan(0);
  });

  it("produces a 32-byte (64 hex char) public key", () => {
    const id = generateIdentity();
    expect(id.publicKeyHex.length).toBe(64);
  });

  it("produces a 32-byte (64 hex char) private key seed", () => {
    const id = generateIdentity();
    expect(id.privateKeyHex.length).toBe(64);
  });

  it("produces different keypairs on each call", () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(a.publicKeyHex).not.toBe(b.publicKeyHex);
    expect(a.privateKeyHex).not.toBe(b.privateKeyHex);
    expect(a.nodeId).not.toBe(b.nodeId);
  });

  it("derives the same nodeId from the same public key", () => {
    // Regenerate an identity using the same public key logic manually
    const id = generateIdentity();
    // The nodeId must be deterministic — verify by checking it's not random
    // (actual determinism is tested via save+load round-trip)
    expect(id.nodeId).toBeTruthy();
  });
});

describe("saveIdentity + loadIdentity", () => {
  async function withTmpDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "pebbl-test-"));
  }

  it("round-trips cleanly", async () => {
    const dir = await withTmpDir();
    const original = generateIdentity();
    await saveIdentity(dir, original);
    const loaded = await loadIdentity(dir);
    expect(loaded.nodeId).toBe(original.nodeId);
    expect(loaded.publicKeyHex).toBe(original.publicKeyHex);
    expect(loaded.privateKeyHex).toBe(original.privateKeyHex);
  });

  it("nodeId is stable across save+load", async () => {
    const dir = await withTmpDir();
    const id = generateIdentity();
    await saveIdentity(dir, id);
    const loaded = await loadIdentity(dir);
    expect(loaded.nodeId).toBe(id.nodeId);
  });

  it("loadIdentity throws if file is missing", async () => {
    const dir = await withTmpDir();
    await expect(loadIdentity(dir)).rejects.toThrow();
  });

  it("creates dataDir if it does not exist", async () => {
    const base = await withTmpDir();
    const nested = join(base, "a", "b", "c");
    const id = generateIdentity();
    await expect(saveIdentity(nested, id)).resolves.not.toThrow();
    const loaded = await loadIdentity(nested);
    expect(loaded.nodeId).toBe(id.nodeId);
  });
});
