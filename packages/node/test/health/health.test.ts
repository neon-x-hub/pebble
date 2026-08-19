import { describe, it, expect } from "vitest";
import { PeerHealth } from "../../src/health/health.js";

describe("PeerHealth", () => {
  it("initializes known peers with unknown status", () => {
    const health = new PeerHealth("self", ["self", "peer-1", "peer-2"]);
    expect(health.getStatus("peer-1")).toBe("unknown");
    expect(health.getStatus("peer-2")).toBe("unknown");
  });

  it("transitions to healthy on recordSuccess", () => {
    const health = new PeerHealth("self", ["self", "peer-1"]);
    health.recordSuccess("peer-1", 25);

    expect(health.getStatus("peer-1")).toBe("healthy");
    const peers = health.getAllPeerInfo();
    expect(peers[0]?.lastRoundTripMs).toBe(25);
    expect(peers[0]?.lastError).toBeNull();
  });

  it("transitions to unhealthy on recordFailure when threshold exceeded", () => {
    const health = new PeerHealth("self", ["self", "peer-1"], 100);
    health.recordFailure("peer-1", "Connection refused");
    expect(health.getStatus("peer-1")).toBe("unhealthy");
  });

  it("selectsGossipTarget from healthy or unknown candidates", () => {
    const health = new PeerHealth("self", ["self", "peer-1", "peer-2"]);
    health.recordSuccess("peer-1", 10);
    health.recordFailure("peer-2", "Offline"); // marked unhealthy (lastSeen=0)

    const target = health.selectGossipTarget();
    expect(target).toBe("peer-1");
  });
});
