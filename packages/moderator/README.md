# @pebbl/moderator

Offline keypair generation and signed client credential issuance tools for Pebble cluster authorities.

## Installation

```bash
pnpm add @pebbl/moderator
```

## Quick Start

```ts
import {
  generateModeratorIdentity,
  generateClientKeypair,
  issueClientCredential,
} from "@pebbl/moderator";

// 1. Generate moderator root authority
const moderator = generateModeratorIdentity();

// 2. Generate client keypair for onboarding
const client = generateClientKeypair();

// 3. Issue signed client credential
const credential = issueClientCredential({
  moderatorPrivateKeyHex: moderator.privateKeyHex,
  clientId: "alice",
  clientPublicKeyHex: client.publicKeyHex,
  permissions: "read-write", // or "read-only"
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
});
```

## Features

- **Decoupled Key Management**: Adding or updating client permissions does not require modifying `cluster.json` or restarting active cluster nodes.
- **Offline Issuance**: The moderator private key remains offline and is never stored on cluster nodes.
- **Self-Verifying**: Any cluster node can verify client credentials independently using the moderator's public key configured in `cluster.json`.

## License

MIT
