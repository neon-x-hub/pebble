import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateIdentity, signCredential } from "@pebbl/crypto";
import { Store } from "@pebbl/core";
import { ClientServer } from "@pebbl/node";
import {
  PermissionDeniedError,
  CredentialExpiredError,
  UnauthorizedClientError,
  type ClientCredential,
  type ClusterConfig,
  type Identity,
} from "@pebbl/types";
import { PebbleClient } from "../src/pebbleClient.js";

describe("PebbleClient SDK", () => {
  const TEST_PORT = 7999;
  let moderator: Identity;
  let nodeIdentity: Identity;
  let store: Store;
  let server: ClientServer;
  let clusterConfig: ClusterConfig;

  beforeEach(async () => {
    moderator = generateIdentity();
    nodeIdentity = generateIdentity();
    store = new Store(nodeIdentity.nodeId);

    clusterConfig = {
      clusterId: "sdk-test-cluster",
      moderatorPublicKey: moderator.publicKeyHex,
      nodes: {
        [nodeIdentity.nodeId]: { publicKey: nodeIdentity.publicKeyHex },
      },
      gossipIntervalMs: 5000,
      pingIntervalMs: 3000,
      unhealthyThresholdMs: 15000,
      gossipPort: 7000,
      clientPort: TEST_PORT,
      limits: {
        maxMessageBytes: 10485760,
        maxMutationsPerMessage: 500,
        maxRangesPerRequest: 100,
        maxKeyBytes: 1024,
        maxValueBytes: 1048576,
      },
    };

    server = new ClientServer(nodeIdentity, clusterConfig, store);
    await server.listen(TEST_PORT);
  });

  afterEach(async () => {
    await server.close();
  });

  function createCredential(
    clientIdentity: Identity,
    permissions: "read-only" | "read-write",
    expiresAt: number | null = null,
  ): ClientCredential {
    const fields: Omit<ClientCredential, "signature"> = {
      clientId: "test-client",
      publicKeyHex: clientIdentity.publicKeyHex,
      permissions,
      issuedAt: Date.now(),
      expiresAt,
    };
    const signature = signCredential(moderator.privateKeyHex, fields);
    return { ...fields, signature };
  }

  it("read-write client performs full CRUD and listing", async () => {
    const clientIdentity = generateIdentity();
    const credential = createCredential(clientIdentity, "read-write");

    const client = await PebbleClient.connect({
      host: "127.0.0.1",
      port: TEST_PORT,
      credential,
      privateKeyHex: clientIdentity.privateKeyHex,
    });

    expect(client.permissions).toBe("read-write");
    expect(await client.get("foo")).toBeUndefined();

    await client.put("foo", "bar");
    expect(await client.get("foo")).toBe("bar");

    await client.put("num", "42");
    const keys = await client.keys();
    expect(keys.sort()).toEqual(["foo", "num"]);

    const entries = await client.entries();
    expect(entries.sort()).toEqual([["foo", "bar"], ["num", "42"]]);

    await client.delete("foo");
    expect(await client.get("foo")).toBeUndefined();
    expect(await client.keys()).toEqual(["num"]);

    await client.close();
  });

  it("read-only client can read but cannot write", async () => {
    // Populate store directly
    store.localPut("greeting", "hello", nodeIdentity);

    const clientIdentity = generateIdentity();
    const credential = createCredential(clientIdentity, "read-only");

    const client = await PebbleClient.connect({
      host: "127.0.0.1",
      port: TEST_PORT,
      credential,
      privateKeyHex: clientIdentity.privateKeyHex,
    });

    expect(client.permissions).toBe("read-only");
    expect(await client.get("greeting")).toBe("hello");
    expect(await client.keys()).toEqual(["greeting"]);

    await expect(client.put("new-key", "value")).rejects.toThrow(PermissionDeniedError);
    await expect(client.delete("greeting")).rejects.toThrow(PermissionDeniedError);

    await client.close();
  });

  it("rejects connection if credential has expired", async () => {
    const clientIdentity = generateIdentity();
    const expiredCredential = createCredential(
      clientIdentity,
      "read-write",
      Date.now() - 5000, // expired 5s ago
    );

    await expect(
      PebbleClient.connect({
        host: "127.0.0.1",
        port: TEST_PORT,
        credential: expiredCredential,
        privateKeyHex: clientIdentity.privateKeyHex,
      }),
    ).rejects.toThrow(CredentialExpiredError);
  });

  it("rejects connection if credential signature is invalid", async () => {
    const clientIdentity = generateIdentity();
    const fakeModerator = generateIdentity();
    const fields: Omit<ClientCredential, "signature"> = {
      clientId: "imposter",
      publicKeyHex: clientIdentity.publicKeyHex,
      permissions: "read-write",
      issuedAt: Date.now(),
      expiresAt: null,
    };
    // Signed by wrong moderator!
    const signature = signCredential(fakeModerator.privateKeyHex, fields);
    const tamperedCredential: ClientCredential = { ...fields, signature };

    await expect(
      PebbleClient.connect({
        host: "127.0.0.1",
        port: TEST_PORT,
        credential: tamperedCredential,
        privateKeyHex: clientIdentity.privateKeyHex,
      }),
    ).rejects.toThrow(UnauthorizedClientError);
  });
});
