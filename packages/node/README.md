# @pebbl/node

Full cluster peer node runtime, gossip replication engine, and client-facing server for Pebble.

## Installation

```bash
pnpm add @pebbl/node
```

## Quick Start

```ts
import { Pebble } from "@pebbl/node";

const node = await Pebble.open({
  dataDir: "./data/node-1",
  configPath: "./cluster.json",
  gossipPort: 7000,
  clientPort: 7001,
});

// Local CRUD API
await node.put("key", "value");
const val = await node.get("key");
console.log("Read value:", val);

// Snapshot & Observability
const snapPath = await node.snapshot();
const stats = node.stats();
const peers = node.peers();

// Teardown
await node.close();
```

## Subsystems

- **`PebbleServer`**: TCP listener on the inter-node gossip port (:7000) with 3-way challenge-response handshake (`HELLO` ➔ `HELLO_ACK` ➔ `HELLO_CONFIRM`).
- **`ClientServer`**: TCP listener on the client port (:7001) verifying offline moderator credentials, checking expiry, and enforcing `read-only` vs `read-write` permissions.
- **`GossipEngine`**: Periodic pull-based symmetric sync sessions (`DIGEST` ➔ `REQUEST` ➔ `MUTATIONS` ➔ `ACK`).
- **`PeerHealth` & `Pinger`**: Round-trip time (RTT) tracking, reachability monitoring, and candidate target selection.

## License

MIT
