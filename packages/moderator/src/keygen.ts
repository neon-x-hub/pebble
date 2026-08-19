import type { ClientCredential, ClientPermission } from "@pebbl/types";
import { generateIdentity, signCredential } from "@pebbl/crypto";

export interface ModeratorIdentity {
  publicKeyHex: string;
  privateKeyHex: string;
}

export interface ClientKeypair {
  publicKeyHex: string;
  privateKeyHex: string;
}

export interface IssueCredentialParams {
  moderatorPrivateKeyHex: string;
  clientId: string;
  clientPublicKeyHex: string;
  permissions: ClientPermission;
  issuedAt?: number | undefined;
  expiresAt?: number | null | undefined;
}

/**
 * Generate a dedicated Ed25519 keypair for the cluster moderator.
 * The moderator public key is distributed in cluster.json to all nodes.
 */
export function generateModeratorIdentity(): ModeratorIdentity {
  const id = generateIdentity();
  return {
    publicKeyHex: id.publicKeyHex,
    privateKeyHex: id.privateKeyHex,
  };
}

/**
 * Generate a fresh Ed25519 keypair for an external client.
 * The private key is given to the client; the public key is embedded in their credential.
 */
export function generateClientKeypair(): ClientKeypair {
  const id = generateIdentity();
  return {
    publicKeyHex: id.publicKeyHex,
    privateKeyHex: id.privateKeyHex,
  };
}

/**
 * Issue and sign an offline ClientCredential bundle.
 * Can be verified by any node in the cluster against the moderator's public key.
 */
export function issueClientCredential(params: IssueCredentialParams): ClientCredential {
  const fields: Omit<ClientCredential, "signature"> = {
    clientId: params.clientId,
    publicKeyHex: params.clientPublicKeyHex,
    permissions: params.permissions,
    issuedAt: params.issuedAt ?? Date.now(),
    expiresAt: params.expiresAt ?? null,
  };

  const signature = signCredential(params.moderatorPrivateKeyHex, fields);
  return {
    ...fields,
    signature,
  };
}
