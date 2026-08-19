import { randomBytes, verify } from "node:crypto";
import {
  ClientMessageType,
  type ClientCredential,
  type ClientPermission,
  UnauthorizedClientError,
  CredentialExpiredError,
  InvalidSignatureError,
  ProtocolError,
} from "@pebbl/types";
import { verifyCredential, publicKeyFromHex } from "@pebbl/crypto";
import type { PeerConnection } from "../network/connection.js";

export interface AuthenticatedClient {
  clientId: string;
  permissions: ClientPermission;
  publicKeyHex: string;
}

/**
 * Perform server-side auth challenge-response with an incoming client.
 * 1. Node -> Client: AUTH_CHALLENGE { nonce }
 * 2. Client -> Node: AUTH_RESPONSE { credential, nonce_sig }
 * 3. Node verifies moderator signature on credential, checks expiry, and verifies client signature on nonce.
 * 4. Node -> Client: AUTH_ACK { accepted: true, permissions }
 */
export async function authenticateClient(
  conn: PeerConnection,
  moderatorPublicKey: string,
): Promise<AuthenticatedClient> {
  const nonce = randomBytes(16).toString("hex");

  // 1. Send challenge
  await conn.send(ClientMessageType.AUTH_CHALLENGE, { nonce });

  // 2. Receive response
  const responseFrame = await conn.receive();
  if (responseFrame.type !== ClientMessageType.AUTH_RESPONSE) {
    await conn.send(ClientMessageType.ERROR, { message: "Expected AUTH_RESPONSE" });
    throw new ProtocolError(`Expected AUTH_RESPONSE (0x11), got 0x${responseFrame.type.toString(16)}`);
  }

  const payload = responseFrame.payload as {
    credential?: ClientCredential;
    nonce_sig?: string;
  };

  const credential = payload.credential;
  const nonce_sig = payload.nonce_sig;

  if (!credential || !nonce_sig) {
    await conn.send(ClientMessageType.ERROR, { message: "Missing credential or nonce signature" });
    throw new UnauthorizedClientError("Missing credential or nonce signature");
  }

  // 3a. Verify credential signed by moderator
  const validCred = verifyCredential(moderatorPublicKey, credential);
  if (!validCred) {
    await conn.send(ClientMessageType.ERROR, { message: "Invalid moderator signature on credential" });
    throw new UnauthorizedClientError("Invalid moderator signature on credential");
  }

  // 3b. Check expiry
  if (credential.expiresAt !== null && Date.now() > credential.expiresAt) {
    await conn.send(ClientMessageType.ERROR, { message: "Client credential has expired" });
    throw new CredentialExpiredError(`Credential expired at ${new Date(credential.expiresAt).toISOString()}`);
  }

  // 3c. Verify client signed the nonce
  try {
    const clientPubKey = publicKeyFromHex(credential.publicKeyHex);
    const validNonceSig = verify(
      null,
      Buffer.from(nonce, "utf8"),
      clientPubKey,
      Buffer.from(nonce_sig, "hex"),
    );

    if (!validNonceSig) {
      await conn.send(ClientMessageType.ERROR, { message: "Invalid nonce signature" });
      throw new InvalidSignatureError("Invalid nonce signature from client");
    }
  } catch (err: unknown) {
    await conn.send(ClientMessageType.ERROR, { message: "Nonce signature verification failed" });
    if (err instanceof InvalidSignatureError) throw err;
    throw new InvalidSignatureError(`Client signature verification failed: ${String(err)}`);
  }

  // 4. Send AUTH_ACK
  await conn.send(ClientMessageType.AUTH_ACK, {
    accepted: true,
    permissions: credential.permissions,
  });

  return {
    clientId: credential.clientId,
    permissions: credential.permissions,
    publicKeyHex: credential.publicKeyHex,
  };
}
