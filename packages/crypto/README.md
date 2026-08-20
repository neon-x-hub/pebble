# @pebbl/crypto

Cryptographic identity, deterministic canonical JSON encoding, and Ed25519 digital signature utilities for Pebble.

## Installation

```bash
pnpm add @pebbl/crypto
```

## Features

- **Canonical JSON Encoding**: `canonicalEncode()` produces deterministic UTF-8 byte streams by sorting object keys recursively, preserving types and null values without extraneous whitespace.
- **Ed25519 Identity**: `generateIdentity()`, `loadIdentity()`, and `saveIdentity()` with automatic `nodeId = base64url(SHA-256(publicKey))` derivation.
- **Mutation Signatures**: `signMutation()` and `verifyMutation()` ensuring tamper-proof state replication.
- **Credential Signatures**: `signCredential()` and `verifyCredential()` for offline moderator-signed client access tokens.

## License

MIT
