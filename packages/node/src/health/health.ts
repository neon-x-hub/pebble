import type { PeerInfo, PeerStatus } from "@pebbl/types";

export class PeerHealth {
  private readonly peers = new Map<string, {
    status: PeerStatus;
    lastSeenMs: number;
    lastError: string | null;
    lastRoundTripMs: number | null;
  }>();

  constructor(
    private readonly localNodeId: string,
    private readonly knownNodeIds: string[],
    private readonly unhealthyThresholdMs: number = 15000,
  ) {
    for (const nodeId of knownNodeIds) {
      if (nodeId === localNodeId) continue;
      this.peers.set(nodeId, {
        status: "unknown",
        lastSeenMs: 0,
        lastError: null,
        lastRoundTripMs: null,
      });
    }
  }

  recordSuccess(nodeId: string, rttMs: number): void {
    const peer = this.peers.get(nodeId);
    if (!peer) return;

    peer.status = "healthy";
    peer.lastSeenMs = Date.now();
    peer.lastRoundTripMs = rttMs;
    peer.lastError = null;
  }

  recordFailure(nodeId: string, error: string): void {
    const peer = this.peers.get(nodeId);
    if (!peer) return;

    peer.lastError = error;
    const now = Date.now();
    if (peer.lastSeenMs === 0 || now - peer.lastSeenMs >= this.unhealthyThresholdMs) {
      peer.status = "unhealthy";
    }
  }

  getStatus(nodeId: string): PeerStatus {
    const peer = this.peers.get(nodeId);
    if (!peer) return "unknown";

    if (peer.lastSeenMs > 0 && Date.now() - peer.lastSeenMs >= this.unhealthyThresholdMs) {
      peer.status = "unhealthy";
    }
    return peer.status;
  }

  /**
   * Select a candidate peer for gossip synchronization.
   * Prefers healthy or unknown peers, falling back to unhealthy peers to allow reconnection.
   */
  selectGossipTarget(): string | null {
    const preferred: string[] = [];
    const fallback: string[] = [];

    for (const [nodeId] of this.peers.entries()) {
      const status = this.getStatus(nodeId);
      if (status === "healthy" || status === "unknown") {
        preferred.push(nodeId);
      } else {
        fallback.push(nodeId);
      }
    }

    const pool = preferred.length > 0 ? preferred : fallback;
    if (pool.length === 0) {
      return null;
    }

    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx] ?? null;
  }

  getAllPeerInfo(): PeerInfo[] {
    const list: PeerInfo[] = [];
    for (const [nodeId, info] of this.peers.entries()) {
      list.push({
        nodeId,
        status: this.getStatus(nodeId),
        lastSeenMs: info.lastSeenMs,
        lastError: info.lastError,
        lastRoundTripMs: info.lastRoundTripMs,
      });
    }
    return list;
  }
}
