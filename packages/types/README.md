# @pebbl/types

Core domain types, protocol constants, and error hierarchy for Pebble distributed key-value store.

This package contains zero runtime dependencies and serves as the type foundation across all Pebble packages.

## Installation

```bash
pnpm add @pebbl/types
```

## Contents

- **Domain Interfaces**: `Mutation`, `VersionVector`, `MutationRange`, `ClusterConfig`, `NodeConfig`, `ProtocolLimits`, `Identity`, `PeerInfo`, `ClientCredential`, `ClientPermission`.
- **Protocol Constants**:
  - `GossipMessageType`: HELLO, HELLO_ACK, HELLO_CONFIRM, PING, PONG, DIGEST, REQUEST, MUTATIONS, ACK, ERROR.
  - `ClientMessageType`: AUTH_CHALLENGE, AUTH_RESPONSE, AUTH_ACK, GET_REQUEST, GET_RESPONSE, PUT_REQUEST, PUT_RESPONSE, DELETE_REQUEST, DELETE_RESPONSE, KEYS_REQUEST, KEYS_RESPONSE, ENTRIES_REQUEST, ENTRIES_RESPONSE, ERROR.
- **Error Classes**: `PebbleError`, `InvalidSignatureError`, `InvalidMutationError`, `SequenceCollisionError`, `UnknownNodeError`, `UnauthorizedClientError`, `CredentialExpiredError`, `PermissionDeniedError`, `ProtocolError`, `MessageTooLargeError`, `ValueTooLargeError`.

## License

MIT
