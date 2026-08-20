# @pebbl/core

In-memory state machine, Last-Write-Wins (LWW) conflict resolution, append-only NDJSON mutation log, and crash recovery pipeline for Pebble.

This package is completely decoupled from the network layer.

## Installation

```bash
pnpm add @pebbl/core
```

## Features

- **Store**: In-memory state machine maintaining current winning values, full mutation history index, version vectors, and monotonic sequence counters.
- **LWW Conflict Resolution**: Deterministic multi-dimensional comparison:
  1. Highest `timestamp` wins.
  2. If equal, lexicographical `nodeId` tiebreak.
  3. If same node, highest `sequence` tiebreak.
- **Append-Only Mutation Log**: `MutationLog` with fsync durability and corrupted tail recovery (skips incomplete lines written during power loss/abrupt crashes).
- **Snapshots & Metadata**: Point-in-time state snapshots and atomic metadata persistence with crash-safe temporary file swapping.
- **Recovery Pipeline**: `recover()` automatically restores state from the latest snapshot and replays subsequent log mutations.

## License

MIT
