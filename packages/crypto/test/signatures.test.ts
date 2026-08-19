import { describe, it, expect } from "vitest";
import { generateIdentity } from "../src/identity.js";
import {
  signMutation,
  verifyMutation,
  signCredential,
  verifyCredential,
} from "../src/signatures.js";
import type { Mutation, ClientCredential } from "@pebbl/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMutation(overrides: Partial<Mutation> = {}): Mutation {
  const id = generateIdentity();
  const fields = {
    nodeId: id.nodeId,
    sequence: 1,
    timestamp: 1787060000000,
    operation: "put" as const,
    key: "color",
    value: "red",
    ...overrides,
  };
  const signature = signMutation(id.privateKeyHex, fields);
  return { ...fields, signature };
}

function makeCredential(
  overrides: Partial<Omit<ClientCredential, "signature">> & { moderatorPrivateKeyHex?: string } = {},
) {
  const moderatorId = generateIdentity();
  const clientId = generateIdentity();
  const { moderatorPrivateKeyHex = moderatorId.privateKeyHex, ...credOverrides } = overrides;
  const fields: Omit<ClientCredential, "signature"> = {
    clientId: "alice",
    publicKeyHex: clientId.publicKeyHex,
    permissions: "read-write",
    issuedAt: 1787060000000,
    expiresAt: null,
    ...credOverrides,
  };
  const signature = signCredential(moderatorPrivateKeyHex, fields);
  return {
    credential: { ...fields, signature } as ClientCredential,
    moderatorPublicKeyHex: moderatorId.publicKeyHex,
    clientPublicKeyHex: clientId.publicKeyHex,
    clientPrivateKeyHex: clientId.privateKeyHex,
  };
}

// ---------------------------------------------------------------------------
// Mutation signing
// ---------------------------------------------------------------------------

describe("signMutation + verifyMutation", () => {
  it("valid signature verifies correctly", () => {
    const id = generateIdentity();
    const fields = {
      nodeId: id.nodeId,
      sequence: 1,
      timestamp: 1787060000000,
      operation: "put" as const,
      key: "color",
      value: "red",
    };
    const sig = signMutation(id.privateKeyHex, fields);
    const mutation: Mutation = { ...fields, signature: sig };
    expect(verifyMutation(id.publicKeyHex, mutation)).toBe(true);
  });

  it("tampered key field → false", () => {
    const mutation = makeMutation();
    expect(verifyMutation(
      generateIdentity().publicKeyHex, // wrong key
      { ...mutation, key: "TAMPERED" },
    )).toBe(false);
  });

  it("tampered value → false", () => {
    const id = generateIdentity();
    const fields = { nodeId: id.nodeId, sequence: 1, timestamp: 1_000, operation: "put" as const, key: "k", value: "v" };
    const mutation: Mutation = { ...fields, signature: signMutation(id.privateKeyHex, fields) };
    expect(verifyMutation(id.publicKeyHex, { ...mutation, value: "TAMPERED" })).toBe(false);
  });

  it("tampered timestamp → false", () => {
    const id = generateIdentity();
    const fields = { nodeId: id.nodeId, sequence: 1, timestamp: 1_000, operation: "put" as const, key: "k", value: "v" };
    const mutation: Mutation = { ...fields, signature: signMutation(id.privateKeyHex, fields) };
    expect(verifyMutation(id.publicKeyHex, { ...mutation, timestamp: 2_000 })).toBe(false);
  });

  it("tampered sequence → false", () => {
    const id = generateIdentity();
    const fields = { nodeId: id.nodeId, sequence: 1, timestamp: 1_000, operation: "put" as const, key: "k", value: "v" };
    const mutation: Mutation = { ...fields, signature: signMutation(id.privateKeyHex, fields) };
    expect(verifyMutation(id.publicKeyHex, { ...mutation, sequence: 99 })).toBe(false);
  });

  it("tampered signature → false", () => {
    const id = generateIdentity();
    const fields = { nodeId: id.nodeId, sequence: 1, timestamp: 1_000, operation: "put" as const, key: "k", value: "v" };
    const mutation: Mutation = { ...fields, signature: "00".repeat(64) };
    expect(verifyMutation(id.publicKeyHex, mutation)).toBe(false);
  });

  it("different private key signs, original public key verifies → false", () => {
    const signer = generateIdentity();
    const other = generateIdentity();
    const fields = { nodeId: signer.nodeId, sequence: 1, timestamp: 1_000, operation: "put" as const, key: "k", value: "v" };
    // Sign with `other`'s private key but verify against `signer`'s public key
    const mutation: Mutation = { ...fields, signature: signMutation(other.privateKeyHex, fields) };
    expect(verifyMutation(signer.publicKeyHex, mutation)).toBe(false);
  });

  it("tombstone (value: null) signs and verifies correctly", () => {
    const id = generateIdentity();
    const fields = { nodeId: id.nodeId, sequence: 2, timestamp: 2_000, operation: "delete" as const, key: "k", value: null };
    const sig = signMutation(id.privateKeyHex, fields);
    expect(verifyMutation(id.publicKeyHex, { ...fields, signature: sig })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Credential signing
// ---------------------------------------------------------------------------

describe("signCredential + verifyCredential", () => {
  it("valid credential verifies against moderator key", () => {
    const { credential, moderatorPublicKeyHex } = makeCredential();
    expect(verifyCredential(moderatorPublicKeyHex, credential)).toBe(true);
  });

  it("tampered permissions → false", () => {
    const { credential, moderatorPublicKeyHex } = makeCredential();
    expect(verifyCredential(moderatorPublicKeyHex, { ...credential, permissions: "read-only" })).toBe(false);
  });

  it("tampered publicKeyHex → false", () => {
    const { credential, moderatorPublicKeyHex } = makeCredential();
    const otherKey = generateIdentity().publicKeyHex;
    expect(verifyCredential(moderatorPublicKeyHex, { ...credential, publicKeyHex: otherKey })).toBe(false);
  });

  it("tampered clientId → false", () => {
    const { credential, moderatorPublicKeyHex } = makeCredential();
    expect(verifyCredential(moderatorPublicKeyHex, { ...credential, clientId: "eve" })).toBe(false);
  });

  it("wrong moderator public key → false", () => {
    const { credential } = makeCredential();
    const wrongModerator = generateIdentity().publicKeyHex;
    expect(verifyCredential(wrongModerator, credential)).toBe(false);
  });

  it("expiresAt: null is preserved and verifies correctly", () => {
    const { credential, moderatorPublicKeyHex } = makeCredential({ expiresAt: null });
    expect(credential.expiresAt).toBeNull();
    expect(verifyCredential(moderatorPublicKeyHex, credential)).toBe(true);
  });

  it("expiresAt: timestamp is preserved and verifies correctly", () => {
    const future = Date.now() + 90 * 24 * 60 * 60 * 1000;
    const { credential, moderatorPublicKeyHex } = makeCredential({ expiresAt: future });
    expect(credential.expiresAt).toBe(future);
    expect(verifyCredential(moderatorPublicKeyHex, credential)).toBe(true);
  });

  it("read-only permission signs and verifies", () => {
    const { credential, moderatorPublicKeyHex } = makeCredential({ permissions: "read-only" });
    expect(verifyCredential(moderatorPublicKeyHex, credential)).toBe(true);
  });

  it("credential signed by different moderator does not verify against original", () => {
    const moderator1 = generateIdentity();
    const moderator2 = generateIdentity();
    const clientId2 = generateIdentity();
    const fields = {
      clientId: "bob",
      publicKeyHex: clientId2.publicKeyHex,
      permissions: "read-write" as const,
      issuedAt: 1_000,
      expiresAt: null,
    };
    const sig = signCredential(moderator2.privateKeyHex, fields);
    const credential: ClientCredential = { ...fields, signature: sig };
    // Verify against moderator1's key — should fail
    expect(verifyCredential(moderator1.publicKeyHex, credential)).toBe(false);
    // Verify against moderator2's key — should pass
    expect(verifyCredential(moderator2.publicKeyHex, credential)).toBe(true);
  });
});
