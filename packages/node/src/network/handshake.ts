import { randomBytes, sign, verify } from "node:crypto";
import {
  GossipMessageType,
  type ClusterConfig,
  type Identity,
  UnknownNodeError,
  ProtocolError,
  InvalidSignatureError,
} from "@pebbl/types";
import { privateKeyFromHex, publicKeyFromHex } from "@pebbl/crypto";
import type { PeerConnection } from "./connection.js";

const PROTOCOL_VERSION = 1;

export interface HandshakeResult {
  remoteNodeId: string;
  remotePublicKey: string;
}

/**
 * Initiator side of 3-way challenge-response handshake:
 * A -> B: HELLO { nodeId, publicKey, clusterId, protocol, nonce_A }
 * B -> A: HELLO_ACK { nodeId, publicKey, clusterId, accepted, nonce_A_sig, nonce_B }
 * A -> B: HELLO_CONFIRM { nonce_B_sig }
 */
export async function initiateHandshake(
  connection: PeerConnection,
  localIdentity: Identity,
  config: ClusterConfig,
): Promise<HandshakeResult> {
  const nonce_A = randomBytes(16).toString("hex");

  // 1. Send HELLO
  await connection.send(GossipMessageType.HELLO, {
    nodeId: localIdentity.nodeId,
    publicKey: localIdentity.publicKeyHex,
    clusterId: config.clusterId,
    protocol: PROTOCOL_VERSION,
    nonce_A,
  });

  // 2. Receive HELLO_ACK
  const ackFrame = await connection.receive();
  if (ackFrame.type === GossipMessageType.ERROR) {
    throw new ProtocolError(`Peer rejected handshake with error: ${JSON.stringify(ackFrame.payload)}`);
  }
  if (ackFrame.type !== GossipMessageType.HELLO_ACK) {
    throw new ProtocolError(`Expected HELLO_ACK (0x02), got 0x${ackFrame.type.toString(16)}`);
  }

  const ack = ackFrame.payload as Record<string, unknown>;
  const remoteNodeId = String(ack["nodeId"] || "");
  const remotePublicKey = String(ack["publicKey"] || "");
  const remoteClusterId = String(ack["clusterId"] || "");
  const nonce_A_sig = String(ack["nonce_A_sig"] || "");
  const nonce_B = String(ack["nonce_B"] || "");

  if (remoteClusterId !== config.clusterId) {
    throw new ProtocolError(`Cluster mismatch: expected ${config.clusterId}, got ${remoteClusterId}`);
  }

  const expectedNode = config.nodes[remoteNodeId];
  if (!expectedNode) {
    throw new UnknownNodeError(`Remote node ${remoteNodeId} is not in cluster configuration`);
  }
  if (expectedNode.publicKey !== remotePublicKey) {
    throw new ProtocolError(`Public key mismatch for remote node ${remoteNodeId}`);
  }

  // Verify nonce_A_sig
  const pubKey = publicKeyFromHex(remotePublicKey);
  const valid = verify(null, Buffer.from(nonce_A, "utf8"), pubKey, Buffer.from(nonce_A_sig, "hex"));
  if (!valid) {
    throw new InvalidSignatureError(`Invalid nonce_A signature from ${remoteNodeId}`);
  }

  // 3. Send HELLO_CONFIRM
  const privKey = privateKeyFromHex(localIdentity.privateKeyHex);
  const nonce_B_sig = sign(null, Buffer.from(nonce_B, "utf8"), privKey).toString("hex");

  await connection.send(GossipMessageType.HELLO_CONFIRM, {
    nonce_B_sig,
  });

  return {
    remoteNodeId,
    remotePublicKey,
  };
}

/**
 * Responder side of 3-way challenge-response handshake:
 * Receives HELLO, validates, returns HELLO_ACK with nonce_A_sig and nonce_B,
 * then awaits and verifies HELLO_CONFIRM with nonce_B_sig.
 */
export async function acceptHandshake(
  connection: PeerConnection,
  localIdentity: Identity,
  config: ClusterConfig,
): Promise<HandshakeResult> {
  // 1. Receive HELLO
  const helloFrame = await connection.receive();
  if (helloFrame.type !== GossipMessageType.HELLO) {
    await connection.send(GossipMessageType.ERROR, { message: "Expected HELLO" });
    throw new ProtocolError(`Expected HELLO (0x01), got 0x${helloFrame.type.toString(16)}`);
  }

  const hello = helloFrame.payload as Record<string, unknown>;
  const remoteNodeId = String(hello["nodeId"] || "");
  const remotePublicKey = String(hello["publicKey"] || "");
  const remoteClusterId = String(hello["clusterId"] || "");
  const protocol = Number(hello["protocol"] || 0);
  const nonce_A = String(hello["nonce_A"] || "");

  if (remoteClusterId !== config.clusterId) {
    await connection.send(GossipMessageType.ERROR, { message: "Cluster ID mismatch" });
    throw new ProtocolError(`Cluster mismatch: expected ${config.clusterId}, got ${remoteClusterId}`);
  }

  if (protocol !== PROTOCOL_VERSION) {
    await connection.send(GossipMessageType.ERROR, { message: "Unsupported protocol version" });
    throw new ProtocolError(`Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${protocol}`);
  }

  const expectedNode = config.nodes[remoteNodeId];
  if (!expectedNode) {
    await connection.send(GossipMessageType.ERROR, { message: "Unknown node ID" });
    throw new UnknownNodeError(`Remote node ${remoteNodeId} is not in cluster configuration`);
  }

  if (expectedNode.publicKey !== remotePublicKey) {
    await connection.send(GossipMessageType.ERROR, { message: "Public key mismatch" });
    throw new ProtocolError(`Public key mismatch for remote node ${remoteNodeId}`);
  }

  // 2. Send HELLO_ACK
  const nonce_B = randomBytes(16).toString("hex");
  const privKey = privateKeyFromHex(localIdentity.privateKeyHex);
  const nonce_A_sig = sign(null, Buffer.from(nonce_A, "utf8"), privKey).toString("hex");

  await connection.send(GossipMessageType.HELLO_ACK, {
    nodeId: localIdentity.nodeId,
    publicKey: localIdentity.publicKeyHex,
    clusterId: config.clusterId,
    accepted: true,
    nonce_A_sig,
    nonce_B,
  });

  // 3. Receive HELLO_CONFIRM
  const confirmFrame = await connection.receive();
  if (confirmFrame.type !== GossipMessageType.HELLO_CONFIRM) {
    await connection.send(GossipMessageType.ERROR, { message: "Expected HELLO_CONFIRM" });
    throw new ProtocolError(`Expected HELLO_CONFIRM (0x03), got 0x${confirmFrame.type.toString(16)}`);
  }

  const confirm = confirmFrame.payload as Record<string, unknown>;
  const nonce_B_sig = String(confirm["nonce_B_sig"] || "");

  // Verify nonce_B_sig
  const pubKey = publicKeyFromHex(remotePublicKey);
  const valid = verify(null, Buffer.from(nonce_B, "utf8"), pubKey, Buffer.from(nonce_B_sig, "hex"));
  if (!valid) {
    await connection.send(GossipMessageType.ERROR, { message: "Invalid signature" });
    throw new InvalidSignatureError(`Invalid nonce_B signature from ${remoteNodeId}`);
  }

  return {
    remoteNodeId,
    remotePublicKey,
  };
}
