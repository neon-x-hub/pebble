/**
 * Base class for all Pebble errors.
 * Carry the class name as `name` so `instanceof` works across module boundaries.
 */
export class PebbleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// ---------------------------------------------------------------------------
// Cryptographic / mutation errors
// ---------------------------------------------------------------------------

/** A mutation's Ed25519 signature does not verify against the expected public key. */
export class InvalidSignatureError extends PebbleError {}

/** A mutation's structure is malformed (missing fields, wrong types, bad values). */
export class InvalidMutationError extends PebbleError {}

/**
 * A mutation ID collision: two mutations share the same (nodeId, sequence)
 * but have different content. This is treated as a security violation.
 */
export class SequenceCollisionError extends PebbleError {}

// ---------------------------------------------------------------------------
// Peer / cluster errors
// ---------------------------------------------------------------------------

/** A nodeId presented during the inter-node handshake is not in the cluster config. */
export class UnknownNodeError extends PebbleError {}

// ---------------------------------------------------------------------------
// Client auth errors
// ---------------------------------------------------------------------------

/**
 * A client credential failed verification — either the moderator signature is
 * invalid, or the presented public key does not match the credential.
 */
export class UnauthorizedClientError extends PebbleError {}

/** A client credential's `expiresAt` timestamp is in the past. */
export class CredentialExpiredError extends PebbleError {}

/** A read-only client attempted a write operation (PUT or DELETE). */
export class PermissionDeniedError extends PebbleError {}

// ---------------------------------------------------------------------------
// Protocol / transport errors
// ---------------------------------------------------------------------------

/** A protocol-level framing or message sequencing violation. */
export class ProtocolError extends PebbleError {}

/** An incoming message exceeds the configured `maxMessageBytes` limit. */
export class MessageTooLargeError extends PebbleError {}

/** A key or value exceeds the configured byte-length limit. */
export class ValueTooLargeError extends PebbleError {}
