# @pebbl/wire

Binary length-type-payload framing and streaming frame decoder for Pebble.

## Wire Format

Every TCP message is framed with a 5-byte header:

```
+--------------------+------------------+-----------------------------+
| uint32 BE (4 bytes)| uint8 (1 byte)   | Variable length (N bytes)   |
| Payload byte length| Message type code| UTF-8 JSON encoded body     |
+--------------------+------------------+-----------------------------+
```

## Installation

```bash
pnpm add @pebbl/wire
```

## Features

- **`encodeFrame(type, payload)`**: Encodes any JSON-serializable payload into a raw Buffer frame.
- **`FrameDecoder`**: Stateful streaming frame accumulator that tolerates arbitrary TCP chunk fragmentation, multiple frames per chunk, and single-byte pushes while enforcing maximum message size limits (`MessageTooLargeError`).

## License

MIT
