import { describe, it, expect } from "vitest";
import { generateIdentity } from "@pebbl/crypto";
import { Store } from "@pebbl/core";
import { ClientMessageType, type ClusterConfig } from "@pebbl/types";
import { PeerConnection } from "../../src/network/connection.js";
import { handleClientFrame } from "../../src/clientServer/clientHandler.js";
import { makeDuplexPair } from "../testHelpers.js";

const testConfig: ClusterConfig = {
  clusterId: "test-cluster",
  moderatorPublicKey: "mod-pub",
  nodes: {},
  gossipIntervalMs: 5000,
  pingIntervalMs: 3000,
  unhealthyThresholdMs: 15000,
  gossipPort: 7000,
  clientPort: 7001,
  limits: {
    maxMessageBytes: 10485760,
    maxMutationsPerMessage: 500,
    maxRangesPerRequest: 100,
    maxKeyBytes: 1024,
    maxValueBytes: 1048576,
  },
};

describe("Client Frame Handler", () => {
  it("read-write client can PUT and GET", async () => {
    const id = generateIdentity();
    const store = new Store(id.nodeId);
    const [serverSock, clientSock] = makeDuplexPair();
    const serverConn = new PeerConnection(serverSock);
    const clientConn = new PeerConnection(clientSock);

    const client = { clientId: "rw-user", permissions: "read-write" as const, publicKeyHex: "pub" };

    // 1. PUT request
    const putTask = async () => {
      await clientConn.send(ClientMessageType.PUT_REQUEST, {
        requestId: "r1",
        key: "foo",
        value: "bar",
      });
      const res = await clientConn.receive();
      expect(res.type).toBe(ClientMessageType.PUT_RESPONSE);
    };

    const serverPutTask = async () => {
      const frame = await serverConn.receive();
      await handleClientFrame(serverConn, frame, client, store, id, testConfig);
    };

    await Promise.all([putTask(), serverPutTask()]);
    expect(store.get("foo")).toBe("bar");

    // 2. GET request
    const getTask = async () => {
      await clientConn.send(ClientMessageType.GET_REQUEST, {
        requestId: "r2",
        key: "foo",
      });
      const res = await clientConn.receive();
      expect(res.type).toBe(ClientMessageType.GET_RESPONSE);
      expect((res.payload as { value: string }).value).toBe("bar");
    };

    const serverGetTask = async () => {
      const frame = await serverConn.receive();
      await handleClientFrame(serverConn, frame, client, store, id, testConfig);
    };

    await Promise.all([getTask(), serverGetTask()]);
  });

  it("read-only client cannot PUT", async () => {
    const id = generateIdentity();
    const store = new Store(id.nodeId);
    const [serverSock, clientSock] = makeDuplexPair();
    const serverConn = new PeerConnection(serverSock);
    const clientConn = new PeerConnection(clientSock);

    const client = { clientId: "ro-user", permissions: "read-only" as const, publicKeyHex: "pub" };

    const putTask = async () => {
      await clientConn.send(ClientMessageType.PUT_REQUEST, {
        requestId: "r1",
        key: "k",
        value: "v",
      });
      const res = await clientConn.receive();
      expect(res.type).toBe(ClientMessageType.ERROR);
      expect((res.payload as { code: string }).code).toBe("PERMISSION_DENIED");
    };

    const serverTask = async () => {
      const frame = await serverConn.receive();
      await handleClientFrame(serverConn, frame, client, store, id, testConfig);
    };

    await Promise.all([putTask(), serverTask()]);
    expect(store.get("k")).toBeUndefined();
  });
});
