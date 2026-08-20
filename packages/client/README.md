# @pebbl/client

Client SDK for connecting to any node in a Pebble cluster with permission-aware challenge authentication and multiplexed request correlation.

## Installation

```bash
pnpm add @pebbl/client
```

## Quick Start

```ts
import { PebbleClient } from "@pebbl/client";

const client = await PebbleClient.connect({
  host: "127.0.0.1",
  port: 7001,
  credential: myCredentialBundle,
  privateKeyHex: myPrivateKeySeed,
});

// Read-write operations
await client.put("user:profile", JSON.stringify({ name: "Alice" }));
const profile = await client.get("user:profile");

// Listing keys and entries
const keys = await client.keys();
const entries = await client.entries();

// Delete key
await client.delete("user:profile");

// Teardown
await client.close();
```

## Features

- **Automated Handshake**: Solves cryptographic challenge nonces during initial connection setup using the client's private key.
- **Multiplexed Requests**: Employs unique `requestId` matching to handle concurrent asynchronous calls over a single TCP socket.
- **Permission Enforcement**: Gated client-side and server-side (`read-only` vs `read-write`).

## License

MIT
