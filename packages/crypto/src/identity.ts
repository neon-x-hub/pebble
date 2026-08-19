import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  createHash,
} from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Identity } from "@pebbl/types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Encode a raw Ed25519 public key Buffer as hex. */
function publicKeyToHex(rawPublicKey: Buffer): string {
  return rawPublicKey.toString("hex");
}

/** Encode a raw Ed25519 private key Buffer (seed || publicKey, 64 bytes) as hex. */
function privateKeyToHex(rawPrivateKey: Buffer): string {
  return rawPrivateKey.toString("hex");
}

/**
 * Derive the Pebble nodeId from a raw Ed25519 public key.
 * nodeId = base64url(SHA-256(rawPublicKey))
 *
 * base64url is URL-safe (no +, /, =) and compact enough for use as a node
 * identifier in mutation IDs and configuration keys.
 */
function deriveNodeId(rawPublicKey: Buffer): string {
  return createHash("sha256").update(rawPublicKey).digest("base64url");
}

/**
 * Export the raw bytes from a Node.js KeyObject.
 * For Ed25519 DER-encoded keys, we strip the ASN.1 header (12 bytes for
 * public, 16 bytes for private) to get the raw 32-byte seed / 32-byte pubkey.
 */
function exportRawPublicKey(keyObject: ReturnType<typeof createPublicKey>): Buffer {
  // SubjectPublicKeyInfo DER for Ed25519: 12-byte header + 32-byte key
  const der = keyObject.export({ type: "spki", format: "der" }) as Buffer;
  return der.subarray(12);
}

function exportRawPrivateKey(keyObject: ReturnType<typeof createPrivateKey>): Buffer {
  // PKCS#8 DER for Ed25519: 16-byte header + 32-byte seed
  const der = keyObject.export({ type: "pkcs8", format: "der" }) as Buffer;
  return der.subarray(16);
}

// ---------------------------------------------------------------------------
// Public API — identity
// ---------------------------------------------------------------------------

/**
 * Generate a fresh Ed25519 keypair and derive the node's identity.
 *
 * The returned Identity should be persisted with `saveIdentity()` so the node
 * uses the same keypair across restarts. nodeId is deterministic from the
 * public key, so saving and loading will always reproduce the same nodeId.
 */
export function generateIdentity(): Identity {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const rawPub = exportRawPublicKey(publicKey);
  const rawPriv = exportRawPrivateKey(privateKey);
  return {
    nodeId: deriveNodeId(rawPub),
    publicKeyHex: publicKeyToHex(rawPub),
    privateKeyHex: privateKeyToHex(rawPriv),
  };
}

const IDENTITY_FILE = "identity.json";

/**
 * Persist an identity to `{dataDir}/identity.json`.
 * Creates the directory if it does not exist.
 */
export async function saveIdentity(dataDir: string, identity: Identity): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, IDENTITY_FILE),
    JSON.stringify(identity, null, 2),
    "utf8",
  );
}

/**
 * Load an identity from `{dataDir}/identity.json`.
 * Throws if the file is missing or malformed.
 */
export async function loadIdentity(dataDir: string): Promise<Identity> {
  const raw = await readFile(join(dataDir, IDENTITY_FILE), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["nodeId"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["publicKeyHex"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["privateKeyHex"] !== "string"
  ) {
    throw new Error(`Malformed identity file at ${join(dataDir, IDENTITY_FILE)}`);
  }
  return parsed as Identity;
}

// ---------------------------------------------------------------------------
// Internal: KeyObject reconstruction from hex
// ---------------------------------------------------------------------------

/**
 * Reconstruct a Node.js KeyObject from a 32-byte raw Ed25519 public key (hex).
 * Prepends the 12-byte SubjectPublicKeyInfo ASN.1 header.
 */
export function publicKeyFromHex(hex: string): ReturnType<typeof createPublicKey> {
  const raw = Buffer.from(hex, "hex");
  if (raw.byteLength !== 32) {
    throw new Error(`Invalid Ed25519 public key length: expected 32 bytes, got ${raw.byteLength}`);
  }
  // SubjectPublicKeyInfo DER header for Ed25519
  const header = Buffer.from("302a300506032b657004210", "hex");
  // Correct header: 30 2a 30 05 06 03 2b 65 70 03 21 00
  const spki = Buffer.concat([
    Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
    raw,
  ]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

/**
 * Reconstruct a Node.js KeyObject from a 32-byte raw Ed25519 private key seed (hex).
 * Prepends the 16-byte PKCS#8 ASN.1 header.
 */
export function privateKeyFromHex(hex: string): ReturnType<typeof createPrivateKey> {
  const raw = Buffer.from(hex, "hex");
  if (raw.byteLength !== 32) {
    throw new Error(`Invalid Ed25519 private key length: expected 32 bytes, got ${raw.byteLength}`);
  }
  // PKCS#8 DER header for Ed25519
  const pkcs8 = Buffer.concat([
    Buffer.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]),
    raw,
  ]);
  return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}
