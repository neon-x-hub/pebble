import { sign, verify } from "node:crypto";
import type { Mutation, ClientCredential } from "@pebbl/types";
import { canonicalEncode, type JsonValue } from "./canonical.js";
import { publicKeyFromHex, privateKeyFromHex } from "./identity.js";

// ---------------------------------------------------------------------------
// Mutation signing
// ---------------------------------------------------------------------------

/**
 * All Mutation fields that are covered by the signature.
 * The `signature` field itself is excluded — it cannot sign itself.
 */
export type SignableMutationFields = Omit<Mutation, "signature">;

/**
 * Sign the signable fields of a mutation with the node's Ed25519 private key.
 *
 * @param privateKeyHex - 32-byte Ed25519 private key seed as hex
 * @param fields - All mutation fields except `signature`
 * @returns Hex-encoded Ed25519 signature
 */
export function signMutation(privateKeyHex: string, fields: SignableMutationFields): string {
  const privKey = privateKeyFromHex(privateKeyHex);
  const data = canonicalEncode(fields as unknown as Record<string, JsonValue>);
  return sign(null, data, privKey).toString("hex");
}

/**
 * Verify a mutation's signature against the originating node's public key.
 *
 * @param publicKeyHex - 32-byte Ed25519 public key as hex
 * @param mutation - The full mutation (including `signature`)
 * @returns true if valid, false if invalid
 */
export function verifyMutation(publicKeyHex: string, mutation: Mutation): boolean {
  try {
    const pubKey = publicKeyFromHex(publicKeyHex);
    const { signature, ...fields } = mutation;
    const data = canonicalEncode(fields as unknown as Record<string, JsonValue>);
    const sigBuffer = Buffer.from(signature, "hex");
    return verify(null, data, pubKey, sigBuffer);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Credential signing
// ---------------------------------------------------------------------------

/**
 * All ClientCredential fields covered by the moderator's signature.
 * The `signature` field itself is excluded.
 */
export type SignableCredentialFields = Omit<ClientCredential, "signature">;

/**
 * Sign a client credential with the moderator's Ed25519 private key.
 *
 * @param moderatorPrivateKeyHex - 32-byte moderator private key seed as hex
 * @param fields - All credential fields except `signature`
 * @returns Hex-encoded Ed25519 signature
 */
export function signCredential(
  moderatorPrivateKeyHex: string,
  fields: SignableCredentialFields,
): string {
  const privKey = privateKeyFromHex(moderatorPrivateKeyHex);
  const data = canonicalEncode(fields as unknown as Record<string, JsonValue>);
  return sign(null, data, privKey).toString("hex");
}

/**
 * Verify a client credential's signature against the cluster moderator's public key.
 *
 * @param moderatorPublicKeyHex - 32-byte moderator public key as hex
 * @param credential - The full credential (including `signature`)
 * @returns true if valid, false if invalid
 */
export function verifyCredential(
  moderatorPublicKeyHex: string,
  credential: ClientCredential,
): boolean {
  try {
    const pubKey = publicKeyFromHex(moderatorPublicKeyHex);
    const { signature, ...fields } = credential;
    const data = canonicalEncode(fields as unknown as Record<string, JsonValue>);
    const sigBuffer = Buffer.from(signature, "hex");
    return verify(null, data, pubKey, sigBuffer);
  } catch {
    return false;
  }
}
