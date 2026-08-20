# Pebble

<div align="center">
    <img src="https://raw.githubusercontent.com/neon-x-hub/pebble/main/docs/pebble.png" width="600" />
</div>

[![npm version](https://badge.fury.io/js/%40pebbl%2Fclient.svg)](https://badge.fury.io/js/%40pebbl%2Fclient)
![GitHub](https://img.shields.io/github/stars/neon-x-hub/pebble?style=social)
![GitHub Repo stars](https://img.shields.io/github/stars/neon-x-hub/pebble?style=social)
[![Build Status](https://github.com/neon-x-hub/pebble/actions/workflows/ci.yml/badge.svg)](https://github.com/neon-x-hub/pebble/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/neon-x-hub/pebble/branch/main/graph/badge.svg)](https://codecov.io/gh/neon-x-hub/pebble)

Pebble is an eventually consistent, distributed peer-to-peer key-value store built in TypeScript on Node.js. It replicates data across cluster nodes using a pull-based gossip protocol, resolves concurrent modifications deterministically using Last-Write-Wins (LWW), and authenticates both peer nodes and external clients using Ed25519 digital signatures.

There is no leader election, consensus algorithm (no Raft, no Paxos), or central coordinator. Any cluster node can accept reads and writes, and healthy nodes eventually converge to identical state.

---

## Quick Start

### 1. Installation

Pebble is structured as a pnpm monorepo. Clone the repository and install dependencies:

```bash
git clone https://github.com/neon-x-hub/pebble.git
cd pebble
pnpm install
pnpm run build
```

---

### 2. Basic Usage Walkthrough

#### Step A: Generate Moderator Authority

The cluster moderator holds an offline private key used to sign client credentials. The moderator's public key is placed in the cluster configuration.

```ts
import { generateModeratorIdentity } from "@pebbl/moderator";

const moderator = generateModeratorIdentity();
console.log("Moderator Public Key:", moderator.publicKeyHex);
console.log("Moderator Private Key (keep offline):", moderator.privateKeyHex);
```

#### Step B: Define Cluster Configuration (`cluster.json`)

Create a `cluster.json` file containing the moderator's public key, the public keys of all cluster nodes, and network ports:

```json
{
  "clusterId": "production-cluster",
  "moderatorPublicKey": "<MODERATOR_PUBLIC_KEY_HEX>",
  "nodes": {
    "node-a": { "publicKey": "<NODE_A_PUBLIC_KEY_HEX>" },
    "node-b": { "publicKey": "<NODE_B_PUBLIC_KEY_HEX>" }
  },
  "gossipIntervalMs": 1000,
  "pingIntervalMs": 2000,
  "unhealthyThresholdMs": 10000,
  "gossipPort": 7000,
  "clientPort": 7001,
  "limits": {
    "maxMessageBytes": 10485760,
    "maxMutationsPerMessage": 500,
    "maxRangesPerRequest": 100,
    "maxKeyBytes": 1024,
    "maxValueBytes": 1048576
  }
}
```

#### Step C: Start a Pebble Node

Nodes automatically generate or load their cryptographic identity from their data directory on startup, recover state from local logs and snapshots, and bind to their gossip and client ports.

```ts
import { Pebble } from "@pebbl/node";

const node = await Pebble.open({
  dataDir: "./data/node-a",
  configPath: "./cluster.json",
  gossipPort: 7000,
  clientPort: 7001,
});

console.log(`Node started with ID: ${node.identity.nodeId}`);
```

#### Step D: Issue Client Credentials

Client machines obtain signed credentials from the moderator. This happens offline and does not require modifying cluster configurations or restarting running nodes.

```ts
import { generateClientKeypair, issueClientCredential } from "@pebbl/moderator";

// 1. Generate client keypair
const aliceKeys = generateClientKeypair();

// 2. Issue signed credential bundle
const aliceCredential = issueClientCredential({
  moderatorPrivateKeyHex: moderator.privateKeyHex,
  clientId: "alice",
  clientPublicKeyHex: aliceKeys.publicKeyHex,
  permissions: "read-write", // or "read-only"
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
});

// Deliver aliceCredential and aliceKeys.privateKeyHex to Alice
```

#### Step E: Connect Client and Execute Operations

Client applications import `@pebbl/client` to interact with any node in the cluster.

```ts
import { PebbleClient } from "@pebbl/client";

const client = await PebbleClient.connect({
  host: "127.0.0.1",
  port: 7001,
  credential: aliceCredential,
  privateKeyHex: aliceKeys.privateKeyHex,
});

// Write data
await client.put("user:1001", JSON.stringify({ name: "Alice", active: true }));

// Read data
const value = await client.get("user:1001");
console.log("Retrieved:", value);

// Listing operations
const keys = await client.keys();
const entries = await client.entries();

// Delete (creates a tombstone mutation that replicates across the cluster)
await client.delete("user:1001");

await client.close();
```

---

## System Architecture

Pebble separates cluster internal replication from external client communication by running two distinct TCP services on every node:

```
+-------------------------------------------------------------------+
| Pebble Peer Node                                                  |
|                                                                   |
|   Gossip Port (:7000)                  Client Port (:7001)        |
|   +--------------------------+         +------------------------+ |
|   | PebbleServer             |         | ClientServer           | |
|   | (Inter-node replication) |         | (External client SDK)  | |
|   +------------+-------------+         +-----------+------------+ |
|                |                                   |              |
|                v                                   v              |
|   +-------------------------------------------------------------+ |
|   | Store (State Machine)                                       | |
|   | - Current winning state map                                 | |
|   | - Mutation history index                                    | |
|   | - Version vectors                                           | |
|   | - LWW conflict resolution                                   | |
|   +------------------------------+------------------------------+ |
|                                  |                                |
|                                  v                                |
|   +-------------------------------------------------------------+ |
|   | Persistence Layer                                           | |
|   | - Append-only NDJSON mutation log (with fsync)              | |
|   | - Point-in-time state snapshots                             | |
|   | - Atomic metadata storage                                   | |
|   +-------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

### Two-Port Separation

1. **Gossip Port (`:7000`)**: Dedicated exclusively to inter-node communication. Handles 3-way challenge-response node authentication, PING/PONG health checks, and 4-step symmetric version vector synchronization.
2. **Client Port (`:7001`)**: Dedicated to external clients using `@pebbl/client`. Handles cryptographic credential challenge verification, permission boundary enforcement, and request/response dispatch. External clients never access the gossip port, and peer nodes never communicate over the client port.

---

## Package Architecture

Pebble is split into modular, focused packages under the `@pebbl` namespace:

```
@pebbl/types  (No dependencies)
      ^
      +-----------------------------+
      |                             |
@pebbl/crypto                 @pebbl/wire
      ^                             ^
      |                             |
@pebbl/core ------------------------+
      ^                             |
      +-----------------------------+
      |                             |
@pebbl/node                         @pebbl/client
(Full cluster peer)                 (Client SDK)

@pebbl/moderator
(Offline credential utility)
```

| Package | Path | Responsibility |
|---|---|---|
| `@pebbl/types` | `packages/types` | Shared domain interfaces, protocol message type constants, and error classes. Zero external dependencies. |
| `@pebbl/crypto` | `packages/crypto` | Ed25519 key generation, canonical JSON serialization (`canonicalEncode`), mutation signatures, and credential verification. |
| `@pebbl/wire` | `packages/wire` | Length-type-payload TCP framing and stateful streaming `FrameDecoder`. |
| `@pebbl/core` | `packages/core` | In-memory `Store`, LWW conflict resolution, append-only NDJSON `MutationLog`, snapshots, and startup crash recovery. Zero network code. |
| `@pebbl/node` | `packages/node` | Top-level node orchestrator (`Pebble`), `PebbleServer`, `ClientServer`, `PeerHealth`, `Pinger`, and `GossipEngine`. |
| `@pebbl/client` | `packages/client` | `PebbleClient` SDK with multiplexed request/response tracking and automatic authentication. |
| `@pebbl/moderator` | `packages/moderator` | Offline tools for moderator keypair generation and signed client credential issuance. |

---

## Core Mechanisms

### 1. Data Model & Mutation Immutability

Every state modification is captured as an immutable, signed mutation object:

```json
{
  "nodeId": "node-a",
  "sequence": 42,
  "timestamp": 1787060000000,
  "operation": "put",
  "key": "app:theme",
  "value": "dark",
  "signature": "3045022100..."
}
```

- **Mutation ID**: Uniquely identified across the entire cluster as `"nodeId:sequence"`.
- **Signatures**: Computed over the canonical JSON encoding of all fields except `signature`.
- **Tombstones**: Deletions are represented as mutations with `operation: "delete"` and `value: null`. Tombstones replicate through gossip like writes to ensure deletions propagate reliably.

### 2. Conflict Resolution (Deterministic Last-Write-Wins)

When concurrent writes target the same key on different nodes, every node independently evaluates conflicts using the deterministic `compare` function:

```
1. Compare `timestamp` (highest timestamp wins).
2. If timestamps are equal, compare `nodeId` lexicographically.
3. If mutations originate from the same node, compare `sequence` (highest sequence wins).
```

Because every node applies the same comparison rules, all nodes converge on the identical winning value without requiring distributed locks or leader election.

### 3. Gossip Protocol & Symmetric Synchronization

Nodes run background gossip rounds at configurable intervals (`gossipIntervalMs`). Each round uses a pull-based 4-step symmetric protocol:

```
Node A (Initiator)                                Node B (Responder)
        |                                                 |
Step 1  |--- DIGEST { vector: A } ---------------------->|
        |<-- DIGEST { vector: B } ------------------------|
        |                                                 |
Step 2  |--- REQUEST { ranges: what A needs from B } ---->|
        |<-- MUTATIONS { mutations from B } --------------|
        |                                                 |
Step 3  |<-- REQUEST { ranges: what B needs from A } -----|
        |--- MUTATIONS { mutations from A } ------------->|
        |                                                 |
Step 4  |--- ACK { ok: true } --------------------------->|
        |<-- ACK { ok: true } ----------------------------|
```

- **Incremental Vector Comparison**: Nodes exchange version vectors (mapping `nodeId -> highestSequence`) to calculate exact missing ranges.
- **Deadlock Free**: Both nodes execute a predictable 4-step turn sequence regardless of which node holds newer data.
- **Idempotent Application**: If duplicate mutations arrive, the store recognises the known mutation ID and skips re-application without error.

### 4. Client Authentication & Permission System

Pebble uses a certificate-authority model for client access:

1. **Offline Credential Bundle**: The moderator creates a `ClientCredential` containing `clientId`, `publicKeyHex`, `permissions` (`read-only` or `read-write`), and an optional `expiresAt` timestamp, signed with the moderator's private key.
2. **Challenge-Response Handshake**:
   - Node sends `AUTH_CHALLENGE { nonce }` immediately upon client connection.
   - Client returns `AUTH_RESPONSE { credential, nonce_sig }` (signing the nonce with the client's private key).
   - Node verifies that the moderator signed the credential, checks that `expiresAt` is in the future, and validates the nonce signature using the client's embedded public key.
3. **Permission Enforcement**:
   - `read-only` clients can execute `GET`, `KEYS`, and `ENTRIES`.
   - Attempts by `read-only` clients to execute `PUT` or `DELETE` are rejected with `PERMISSION_DENIED`.

### 5. Persistence & Crash Recovery

Each node stores data inside its isolated `dataDir`:

```
dataDir/
├── identity.json          # Node keypair and derived nodeId
├── metadata.json          # Atomic sequence and version vector counter
├── mutations.log          # Append-only NDJSON mutation log (with fsync)
└── snapshots/             # Point-in-time state snapshots
    └── 2026-08-20T00-00-00-000Z.snapshot.json
```

- **Durability**: Local mutations are appended to `mutations.log` and synced to disk before acknowledgment.
- **Recovery Pipeline (`recover`)**:
  1. Loads the latest snapshot from `snapshots/` if present.
  2. Replays subsequent entries from `mutations.log`.
  3. Reconstructs in-memory state and updates local sequence watermarks.

---

## Core Invariants

Pebble maintains eight core invariants across all subsystems:

1. **Global Uniqueness**: `(nodeId, sequence)` identifies exactly one mutation across the cluster.
2. **Immutability**: Once created and signed, a mutation's contents are never modified.
3. **Authenticity**: Mutations with invalid or tampered signatures are rejected before affecting state.
4. **Idempotence**: Applying an identical mutation multiple times produces the same result as applying it once.
5. **Deterministic Ordering**: Given the same set of mutations, all nodes compute the same winner.
6. **Tombstone Replication**: Deletions propagate through replication to prevent deleted data from reappearing.
7. **Monotonic Vectors**: Version vector high-water marks only move forward.
8. **Monotonic Sequences**: Local sequence numbers never repeat or regress across node restarts.

---

## Development and Testing

### Build the Monorepo

```bash
pnpm run build
```

This triggers `tsc --build`, validating TypeScript project references across all packages in dependency order.

### Run the Test Suite

```bash
# Run unit and integration tests across all packages
pnpm run test
```

### Test Suite Structure

Pebble includes 121 automated tests covering unit logic, failure modes, and end-to-end multi-node cluster scenarios:

- **Cryptographic Tests (`packages/crypto/test`)**: Canonical serialization stability, key derivation, mutation signing/verifying, credential tampering rejection.
- **Framing Tests (`packages/wire/test`)**: Stateful chunk accumulation, single-byte push streams, frame boundaries, oversized message rejection.
- **Store Tests (`packages/core/test`)**: LWW tiebreaking, sequence collision detection, snapshot/log roundtrips, corrupted tail recovery.
- **Node Protocol Tests (`packages/node/test`)**: 3-way handshake verification, health transitions, sync sessions, client auth gating.
- **SDK Tests (`packages/client/test`)**: Full client CRUD lifecycle, multiplexed request correlation, permission denials.
- **Integration Tests (`test/`)**:
  - `convergence.test.ts`: 3-node cluster gossip convergence.
  - `partition.test.ts`: Network partition isolation and healing with conflicting write resolution.
  - `restart.test.ts`: Node crash, snapshot restoration, and catch-up on missed writes.
  - `client-integration.test.ts`: End-to-end client SDK interactions across multiple nodes.
  - `invalid-signature.test.ts`: Security rejection of forged mutations and rogue nodes.
  - `chaos.test.ts`: Hundreds of randomized concurrent writes and deletes across 3 live nodes verifying 100% convergence.

---

## License

MIT
