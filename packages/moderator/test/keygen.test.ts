import { describe, it, expect } from "vitest";
import { verifyCredential } from "@pebbl/crypto";
import {
  generateModeratorIdentity,
  generateClientKeypair,
  issueClientCredential,
} from "../src/keygen.js";

describe("@pebbl/moderator keygen", () => {
  it("generates distinct moderator keypairs", () => {
    const modA = generateModeratorIdentity();
    const modB = generateModeratorIdentity();

    expect(modA.publicKeyHex.length).toBe(64);
    expect(modA.privateKeyHex.length).toBe(64);
    expect(modA.publicKeyHex).not.toBe(modB.publicKeyHex);
  });

  it("generates distinct client keypairs", () => {
    const clientA = generateClientKeypair();
    const clientB = generateClientKeypair();

    expect(clientA.publicKeyHex.length).toBe(64);
    expect(clientA.privateKeyHex.length).toBe(64);
    expect(clientA.publicKeyHex).not.toBe(clientB.publicKeyHex);
  });

  it("issues a credential verified by moderator public key", () => {
    const moderator = generateModeratorIdentity();
    const client = generateClientKeypair();

    const credential = issueClientCredential({
      moderatorPrivateKeyHex: moderator.privateKeyHex,
      clientId: "alice",
      clientPublicKeyHex: client.publicKeyHex,
      permissions: "read-write",
      expiresAt: null,
    });

    expect(credential.clientId).toBe("alice");
    expect(credential.permissions).toBe("read-write");
    expect(credential.expiresAt).toBeNull();
    expect(typeof credential.signature).toBe("string");

    const valid = verifyCredential(moderator.publicKeyHex, credential);
    expect(valid).toBe(true);
  });

  it("verifies read-only credential with expiration", () => {
    const moderator = generateModeratorIdentity();
    const client = generateClientKeypair();
    const expiresAt = Date.now() + 100000;

    const credential = issueClientCredential({
      moderatorPrivateKeyHex: moderator.privateKeyHex,
      clientId: "bob",
      clientPublicKeyHex: client.publicKeyHex,
      permissions: "read-only",
      expiresAt,
    });

    expect(credential.permissions).toBe("read-only");
    expect(credential.expiresAt).toBe(expiresAt);

    const valid = verifyCredential(moderator.publicKeyHex, credential);
    expect(valid).toBe(true);
  });

  it("fails verification if fields are tampered", () => {
    const moderator = generateModeratorIdentity();
    const client = generateClientKeypair();

    const credential = issueClientCredential({
      moderatorPrivateKeyHex: moderator.privateKeyHex,
      clientId: "charlie",
      clientPublicKeyHex: client.publicKeyHex,
      permissions: "read-only",
    });

    // Tamper permissions: read-only -> read-write
    const tampered = { ...credential, permissions: "read-write" as const };
    expect(verifyCredential(moderator.publicKeyHex, tampered)).toBe(false);

    // Tamper clientId
    const tamperedId = { ...credential, clientId: "attacker" };
    expect(verifyCredential(moderator.publicKeyHex, tamperedId)).toBe(false);
  });
});
