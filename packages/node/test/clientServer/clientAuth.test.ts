import { describe, it, expect } from "vitest";
import { generateIdentity, signCredential } from "@pebbl/crypto";
import { ClientMessageType, type ClientCredential } from "@pebbl/types";
import { PeerConnection } from "../../src/network/connection.js";
import { authenticateClient } from "../../src/clientServer/clientAuth.js";
import { makeDuplexPair } from "../testHelpers.js";
import { sign } from "node:crypto";
import { privateKeyFromHex } from "@pebbl/crypto";

describe("Client Authentication", () => {
  it("authenticates valid client credential and nonce signature", async () => {
    const moderator = generateIdentity();
    const clientIdentity = generateIdentity();

    const credFields: Omit<ClientCredential, "signature"> = {
      clientId: "alice",
      publicKeyHex: clientIdentity.publicKeyHex,
      permissions: "read-write",
      issuedAt: Date.now(),
      expiresAt: null,
    };
    const signature = signCredential(moderator.privateKeyHex, credFields);
    const credential: ClientCredential = { ...credFields, signature };

    const [serverSock, clientSock] = makeDuplexPair();
    const serverConn = new PeerConnection(serverSock);
    const clientConn = new PeerConnection(clientSock);

    const clientTask = async () => {
      const challengeFrame = await clientConn.receive();
      expect(challengeFrame.type).toBe(ClientMessageType.AUTH_CHALLENGE);
      const nonce = (challengeFrame.payload as { nonce: string }).nonce;

      const privKey = privateKeyFromHex(clientIdentity.privateKeyHex);
      const nonce_sig = sign(null, Buffer.from(nonce, "utf8"), privKey).toString("hex");

      await clientConn.send(ClientMessageType.AUTH_RESPONSE, {
        credential,
        nonce_sig,
      });

      const ackFrame = await clientConn.receive();
      expect(ackFrame.type).toBe(ClientMessageType.AUTH_ACK);
    };

    const [authResult] = await Promise.all([
      authenticateClient(serverConn, moderator.publicKeyHex),
      clientTask(),
    ]);

    expect(authResult.clientId).toBe("alice");
    expect(authResult.permissions).toBe("read-write");
  });

  it("rejects expired credential with error", async () => {
    const moderator = generateIdentity();
    const clientIdentity = generateIdentity();

    const credFields: Omit<ClientCredential, "signature"> = {
      clientId: "alice",
      publicKeyHex: clientIdentity.publicKeyHex,
      permissions: "read-only",
      issuedAt: Date.now() - 10000,
      expiresAt: Date.now() - 1000, // expired!
    };
    const signature = signCredential(moderator.privateKeyHex, credFields);
    const credential: ClientCredential = { ...credFields, signature };

    const [serverSock, clientSock] = makeDuplexPair();
    const serverConn = new PeerConnection(serverSock);
    const clientConn = new PeerConnection(clientSock);

    const clientTask = async () => {
      const challengeFrame = await clientConn.receive();
      const nonce = (challengeFrame.payload as { nonce: string }).nonce;
      const privKey = privateKeyFromHex(clientIdentity.privateKeyHex);
      const nonce_sig = sign(null, Buffer.from(nonce, "utf8"), privKey).toString("hex");

      await clientConn.send(ClientMessageType.AUTH_RESPONSE, {
        credential,
        nonce_sig,
      });

      const errFrame = await clientConn.receive();
      expect(errFrame.type).toBe(ClientMessageType.ERROR);
    };

    await expect(
      Promise.all([
        authenticateClient(serverConn, moderator.publicKeyHex),
        clientTask(),
      ]),
    ).rejects.toThrow();
  });
});
