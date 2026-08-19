import {
  GossipMessageType,
  type ClusterConfig,
  type Mutation,
  type MutationRange,
  ProtocolError,
} from "@pebbl/types";
import { Store, getMissingRanges } from "@pebbl/core";
import type { PeerConnection } from "../network/connection.js";

export interface SyncResult {
  mutationsReceived: number;
  mutationsSent: number;
  errors: string[];
}

/**
 * Initiator side of symmetric pull-based gossip sync session:
 * Step 1: Send our DIGEST, receive peer's DIGEST
 * Step 2: Send REQUEST (what we need or []), receive MUTATIONS from peer
 * Step 3: Receive REQUEST (what peer needs or []) from peer, send MUTATIONS to peer
 * Step 4: Send ACK, receive ACK
 */
export async function runInitiatorSync(
  conn: PeerConnection,
  store: Store,
  config: ClusterConfig,
): Promise<SyncResult> {
  const result: SyncResult = {
    mutationsReceived: 0,
    mutationsSent: 0,
    errors: [],
  };

  // Step 1: Exchange DIGESTs
  await conn.send(GossipMessageType.DIGEST, {
    vector: store.getVersionVector(),
  });

  const digestFrame = await conn.receive();
  if (digestFrame.type !== GossipMessageType.DIGEST) {
    throw new ProtocolError(`Expected DIGEST (0x06), got 0x${digestFrame.type.toString(16)}`);
  }
  const peerVector = (digestFrame.payload as { vector?: Record<string, number> }).vector ?? {};

  // Step 2: Initiator requests missing mutations from Responder
  const whatWeNeed = getMissingRanges(peerVector, store.getVersionVector());
  const rangesToRequest = whatWeNeed.slice(0, config.limits.maxRangesPerRequest);

  await conn.send(GossipMessageType.REQUEST, { ranges: rangesToRequest });

  const mutFrame = await conn.receive();
  if (mutFrame.type !== GossipMessageType.MUTATIONS) {
    throw new ProtocolError(`Expected MUTATIONS (0x08), got 0x${mutFrame.type.toString(16)}`);
  }

  const receivedMutations = (mutFrame.payload as { mutations?: Mutation[] }).mutations ?? [];
  for (const m of receivedMutations) {
    try {
      store.applyMutation(m, {
        publicKeyResolver: (nid) => config.nodes[nid]?.publicKey,
      });
      result.mutationsReceived++;
    } catch (err: unknown) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Step 3: Responder requests missing mutations from Initiator
  const reqFrame = await conn.receive();
  if (reqFrame.type !== GossipMessageType.REQUEST) {
    throw new ProtocolError(`Expected REQUEST (0x07), got 0x${reqFrame.type.toString(16)}`);
  }

  const requestedRanges = (reqFrame.payload as { ranges?: MutationRange[] }).ranges ?? [];
  const mutationsToSend = requestedRanges.length > 0
    ? store.getMutationsInRanges(requestedRanges).slice(0, config.limits.maxMutationsPerMessage)
    : [];

  await conn.send(GossipMessageType.MUTATIONS, { mutations: mutationsToSend });
  result.mutationsSent += mutationsToSend.length;

  // Step 4: Complete handshake with ACKs
  await conn.send(GossipMessageType.ACK, { ok: true });

  const ackFrame = await conn.receive();
  if (ackFrame.type !== GossipMessageType.ACK) {
    throw new ProtocolError(`Expected ACK (0x09), got 0x${ackFrame.type.toString(16)}`);
  }

  return result;
}

/**
 * Responder side of symmetric pull-based gossip sync session:
 * Step 1: Receive initiator's DIGEST, send our DIGEST
 * Step 2: Receive REQUEST from initiator, send MUTATIONS to initiator
 * Step 3: Send REQUEST to initiator (what we need or []), receive MUTATIONS from initiator
 * Step 4: Receive ACK, send ACK
 */
export async function handleResponderSync(
  conn: PeerConnection,
  store: Store,
  config: ClusterConfig,
  firstFrame?: { type: number; payload: unknown },
): Promise<SyncResult> {
  const result: SyncResult = {
    mutationsReceived: 0,
    mutationsSent: 0,
    errors: [],
  };

  // Step 1: Exchange DIGESTs
  const digestFrame = firstFrame && firstFrame.type === GossipMessageType.DIGEST
    ? firstFrame
    : await conn.receive();

  if (digestFrame.type !== GossipMessageType.DIGEST) {
    throw new ProtocolError(`Expected DIGEST (0x06), got 0x${digestFrame.type.toString(16)}`);
  }
  const peerVector = (digestFrame.payload as { vector?: Record<string, number> }).vector ?? {};

  await conn.send(GossipMessageType.DIGEST, {
    vector: store.getVersionVector(),
  });

  // Step 2: Handle Initiator's REQUEST
  const reqFrame = await conn.receive();
  if (reqFrame.type !== GossipMessageType.REQUEST) {
    throw new ProtocolError(`Expected REQUEST (0x07), got 0x${reqFrame.type.toString(16)}`);
  }

  const requestedRanges = (reqFrame.payload as { ranges?: MutationRange[] }).ranges ?? [];
  const mutationsToSend = requestedRanges.length > 0
    ? store.getMutationsInRanges(requestedRanges).slice(0, config.limits.maxMutationsPerMessage)
    : [];

  await conn.send(GossipMessageType.MUTATIONS, { mutations: mutationsToSend });
  result.mutationsSent += mutationsToSend.length;

  // Step 3: Responder requests missing mutations from Initiator
  const whatWeNeed = getMissingRanges(peerVector, store.getVersionVector());
  const rangesToRequest = whatWeNeed.slice(0, config.limits.maxRangesPerRequest);

  await conn.send(GossipMessageType.REQUEST, { ranges: rangesToRequest });

  const mutFrame = await conn.receive();
  if (mutFrame.type !== GossipMessageType.MUTATIONS) {
    throw new ProtocolError(`Expected MUTATIONS (0x08), got 0x${mutFrame.type.toString(16)}`);
  }

  const receivedMutations = (mutFrame.payload as { mutations?: Mutation[] }).mutations ?? [];
  for (const m of receivedMutations) {
    try {
      store.applyMutation(m, {
        publicKeyResolver: (nid) => config.nodes[nid]?.publicKey,
      });
      result.mutationsReceived++;
    } catch (err: unknown) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Step 4: Complete handshake with ACKs
  const ackFrame = await conn.receive();
  if (ackFrame.type !== GossipMessageType.ACK) {
    throw new ProtocolError(`Expected ACK (0x09), got 0x${ackFrame.type.toString(16)}`);
  }

  await conn.send(GossipMessageType.ACK, { ok: true });

  return result;
}
