import {
  ClientMessageType,
  type ClusterConfig,
  type Identity,
  PermissionDeniedError,
  ValueTooLargeError,
} from "@pebbl/types";
import type { Store } from "@pebbl/core";
import type { Frame } from "@pebbl/wire";
import type { PeerConnection } from "../network/connection.js";
import type { AuthenticatedClient } from "./clientAuth.js";

/**
 * Handle a single client frame according to client permissions and protocol rules.
 */
export async function handleClientFrame(
  conn: PeerConnection,
  frame: Frame,
  client: AuthenticatedClient,
  store: Store,
  identity: Identity,
  config: ClusterConfig,
): Promise<void> {
  const payload = (frame.payload || {}) as Record<string, unknown>;
  const requestId = String(payload["requestId"] || "");

  try {
    switch (frame.type) {
      case ClientMessageType.GET_REQUEST: {
        const key = String(payload["key"] || "");
        const value = store.get(key);
        await conn.send(ClientMessageType.GET_RESPONSE, {
          requestId,
          found: value !== undefined,
          value: value ?? null,
        });
        break;
      }

      case ClientMessageType.KEYS_REQUEST: {
        const keys = store.keys();
        await conn.send(ClientMessageType.KEYS_RESPONSE, {
          requestId,
          keys,
        });
        break;
      }

      case ClientMessageType.ENTRIES_REQUEST: {
        const entries = store.entries();
        await conn.send(ClientMessageType.ENTRIES_RESPONSE, {
          requestId,
          entries,
        });
        break;
      }

      case ClientMessageType.PUT_REQUEST: {
        if (client.permissions !== "read-write") {
          throw new PermissionDeniedError("Read-only client cannot execute PUT");
        }

        const key = String(payload["key"] || "");
        const value = String(payload["value"] || "");

        if (Buffer.byteLength(key, "utf8") > config.limits.maxKeyBytes) {
          throw new ValueTooLargeError(`Key length exceeds maxKeyBytes limit of ${config.limits.maxKeyBytes}`);
        }
        if (Buffer.byteLength(value, "utf8") > config.limits.maxValueBytes) {
          throw new ValueTooLargeError(`Value length exceeds maxValueBytes limit of ${config.limits.maxValueBytes}`);
        }

        store.localPut(key, value, identity);
        await conn.send(ClientMessageType.PUT_RESPONSE, {
          requestId,
          success: true,
        });
        break;
      }

      case ClientMessageType.DELETE_REQUEST: {
        if (client.permissions !== "read-write") {
          throw new PermissionDeniedError("Read-only client cannot execute DELETE");
        }

        const key = String(payload["key"] || "");
        store.localDelete(key, identity);
        await conn.send(ClientMessageType.DELETE_RESPONSE, {
          requestId,
          success: true,
        });
        break;
      }

      default: {
        await conn.send(ClientMessageType.ERROR, {
          requestId,
          code: "UNKNOWN_MESSAGE_TYPE",
          message: `Unknown client message type 0x${frame.type.toString(16)}`,
        });
        break;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof PermissionDeniedError
      ? "PERMISSION_DENIED"
      : err instanceof ValueTooLargeError
        ? "VALUE_TOO_LARGE"
        : "INTERNAL_ERROR";

    await conn.send(ClientMessageType.ERROR, {
      requestId,
      code,
      message,
    });
  }
}
