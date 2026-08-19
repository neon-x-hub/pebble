// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

/** The two possible mutation operations. */
export type Operation = "put" | "delete";

/** Peer reachability status as observed by this node. */
export type PeerStatus = "unknown" | "healthy" | "unhealthy";

/** Access level granted to an external client. */
export type ClientPermission = "read-only" | "read-write";

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

/**
 * An immutable, signed record of a single key-value change.
 * Once created, a mutation's fields never change — they define its identity.
 */
export interface Mutation {
  /** ID of the node that originated this mutation. */
  readonly nodeId: string;
  /** Monotonically increasing counter local to the originating node. */
  readonly sequence: number;
  /** Wall-clock ms timestamp at the time of creation (used for LWW). */
  readonly timestamp: number;
  readonly operation: Operation;
  readonly key: string;
  /** Non-null for "put", null for "delete" (tombstone). */
  readonly value: string | null;
  /** Ed25519 signature (hex) over all other fields via canonicalEncode. */
  readonly signature: string;
}

/**
 * Compact summary of the highest mutation sequence number seen from each node.
 * Used for incremental synchronization: two nodes compare vectors to find gaps.
 *
 * NOTE (v0.1 limitation): assumes contiguous sequences. A high-water mark of N
 * implies mutations 1..N have all been received, which is only correct when
 * sequences arrive in order within a single TCP connection.
 */
export interface VersionVector {
  [nodeId: string]: number;
}

/** A range of mutations from a single origin node to request during gossip. */
export interface MutationRange {
  readonly nodeId: string;
  readonly from: number;
  readonly to: number;
}

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/** Static configuration for a single known peer node. */
export interface NodeConfig {
  /** Hex-encoded Ed25519 public key. Used to verify inter-node handshakes. */
  readonly publicKey: string;
}

/** Hard limits applied to protocol messages and keys/values. */
export interface ProtocolLimits {
  /** Maximum byte length of any single framed message. */
  readonly maxMessageBytes: number;
  /** Maximum number of mutations in a single MUTATIONS message. */
  readonly maxMutationsPerMessage: number;
  /** Maximum number of ranges in a single REQUEST message. */
  readonly maxRangesPerRequest: number;
  /** Maximum byte length of a key. */
  readonly maxKeyBytes: number;
  /** Maximum byte length of a value. */
  readonly maxValueBytes: number;
}

/**
 * The static cluster configuration file (cluster.json).
 *
 * There is no `clients` section — client access is managed via the moderator
 * credential system. Adding a new client does not require updating this file.
 */
export interface ClusterConfig {
  /** Unique name for this cluster. Nodes refuse connections from other clusters. */
  readonly clusterId: string;
  /** All known peer nodes. Each entry contains the node's public key. */
  readonly nodes: Readonly<Record<string, NodeConfig>>;
  /**
   * Hex-encoded Ed25519 public key of the cluster moderator.
   * Used to verify ClientCredential signatures. The only client-related entry
   * in the cluster config — no per-client keys are stored here.
   */
  readonly moderatorPublicKey: string;
  /** How often (ms) each node initiates a gossip sync round. */
  readonly gossipIntervalMs: number;
  /** How often (ms) the pinger sends PING to all peers. */
  readonly pingIntervalMs: number;
  /** Time (ms) after which a non-responding peer is marked unhealthy. */
  readonly unhealthyThresholdMs: number;
  /** TCP port for inter-node gossip traffic. Default: 7000. */
  readonly gossipPort: number;
  /** TCP port for external client connections. Default: 7001. */
  readonly clientPort: number;
  readonly limits: ProtocolLimits;
}

// ---------------------------------------------------------------------------
// Identity and peer info
// ---------------------------------------------------------------------------

/**
 * A node's cryptographic identity.
 * Generated once and persisted to {dataDir}/identity.json.
 * nodeId = base64url(SHA-256(publicKey))
 */
export interface Identity {
  readonly nodeId: string;
  readonly publicKeyHex: string;
  readonly privateKeyHex: string;
}

/** Current health state of a peer as observed by this node. */
export interface PeerInfo {
  readonly nodeId: string;
  readonly status: PeerStatus;
  /** ms timestamp of the last successful communication. */
  readonly lastSeenMs: number;
  readonly lastError: string | null;
  readonly lastRoundTripMs: number | null;
}

// ---------------------------------------------------------------------------
// Client credential
// ---------------------------------------------------------------------------

/**
 * A signed bundle issued by the cluster moderator to an external client.
 * Similar in spirit to an API token or a short-lived certificate.
 *
 * The moderator signs all fields above `signature` using canonicalEncode.
 * Nodes verify the signature against `ClusterConfig.moderatorPublicKey`.
 * The client proves possession of the matching private key by signing the
 * node's nonce during the AUTH handshake.
 *
 * Issuance never requires updating the cluster config.
 */
export interface ClientCredential {
  readonly clientId: string;
  /** Hex-encoded Ed25519 public key belonging to this client. */
  readonly publicKeyHex: string;
  readonly permissions: ClientPermission;
  /** Unix ms timestamp when this credential was issued. */
  readonly issuedAt: number;
  /** Unix ms timestamp after which this credential is invalid. null = no expiry. */
  readonly expiresAt: number | null;
  /** Moderator's Ed25519 signature (hex) over all fields above, via canonicalEncode. */
  readonly signature: string;
}

// ---------------------------------------------------------------------------
// Wire protocol message type constants
// Defined here (not in @pebbl/node or @pebbl/client) so both packages can
// share them without creating a cross-dependency between one another.
// ---------------------------------------------------------------------------

/** Message type bytes for the inter-node gossip protocol (port 7000). */
export const GossipMessageType = {
  HELLO:          0x01,
  HELLO_ACK:      0x02,
  HELLO_CONFIRM:  0x03,
  PING:           0x04,
  PONG:           0x05,
  DIGEST:         0x06,
  REQUEST:        0x07,
  MUTATIONS:      0x08,
  ACK:            0x09,
  ERROR:          0x0a,
} as const;

export type GossipMessageType = (typeof GossipMessageType)[keyof typeof GossipMessageType];

/** Message type bytes for the client protocol (port 7001). */
export const ClientMessageType = {
  // Auth handshake
  AUTH_CHALLENGE:   0x10,
  AUTH_RESPONSE:    0x11,
  AUTH_ACK:         0x12,

  // Client → node requests
  GET_REQUEST:      0x20,
  PUT_REQUEST:      0x21,
  DELETE_REQUEST:   0x22,
  KEYS_REQUEST:     0x23,
  ENTRIES_REQUEST:  0x24,

  // Node → client responses
  GET_RESPONSE:     0x30,
  PUT_RESPONSE:     0x31,
  DELETE_RESPONSE:  0x32,
  KEYS_RESPONSE:    0x33,
  ENTRIES_RESPONSE: 0x34,

  // Shared
  ERROR:            0x09,
} as const;

export type ClientMessageType = (typeof ClientMessageType)[keyof typeof ClientMessageType];
