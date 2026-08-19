import type { Mutation, Operation, VersionVector } from "@pebbl/types";
import { InvalidMutationError } from "@pebbl/types";
import { signMutation } from "@pebbl/crypto";
import type { Identity } from "@pebbl/types";

// ---------------------------------------------------------------------------
// Mutation ID
// ---------------------------------------------------------------------------

/**
 * The globally unique string identifier for a mutation.
 * Format: `"nodeId:sequence"` — e.g. `"node-a:42"`
 */
export function mutationId(m: Pick<Mutation, "nodeId" | "sequence">): string {
  return `${m.nodeId}:${m.sequence}`;
}

// ---------------------------------------------------------------------------
// Mutation creation
// ---------------------------------------------------------------------------

export interface CreateMutationParams {
  identity: Identity;
  sequence: number;
  operation: Operation;
  key: string;
  value: string | null;
  /** Override timestamp — useful for testing. Defaults to Date.now(). */
  timestamp?: number | undefined;
}

/**
 * Create a new, signed mutation from the local node's identity.
 *
 * The caller is responsible for supplying a `sequence` that is greater than
 * any previously used sequence for this `identity.nodeId`. The Store manages
 * this automatically via `localPut` / `localDelete`.
 */
export function createMutation(params: CreateMutationParams): Mutation {
  const { identity, sequence, operation, key, value, timestamp = Date.now() } = params;

  if (operation === "put" && value === null) {
    throw new InvalidMutationError("A 'put' mutation must have a non-null value");
  }
  if (operation === "delete" && value !== null) {
    throw new InvalidMutationError("A 'delete' mutation must have a null value");
  }

  const fields = {
    nodeId: identity.nodeId,
    sequence,
    timestamp,
    operation,
    key,
    value,
  } satisfies Omit<Mutation, "signature">;

  const signature = signMutation(identity.privateKeyHex, fields);
  return { ...fields, signature };
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

/**
 * Validate that a value has the expected shape of a Mutation.
 * Does NOT verify the cryptographic signature.
 * @throws InvalidMutationError on any structural problem
 */
export function validateMutationStructure(raw: unknown): Mutation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidMutationError("Mutation must be a non-null object");
  }
  const m = raw as Record<string, unknown>;

  const nodeId    = m["nodeId"];
  const sequence  = m["sequence"];
  const timestamp = m["timestamp"];
  const operation = m["operation"];
  const key       = m["key"];
  const value     = m["value"];
  const signature = m["signature"];

  if (typeof nodeId !== "string" || nodeId.length === 0) {
    throw new InvalidMutationError("mutation.nodeId must be a non-empty string");
  }
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) {
    throw new InvalidMutationError("mutation.sequence must be a positive integer");
  }
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0) {
    throw new InvalidMutationError("mutation.timestamp must be a non-negative finite number");
  }
  if (operation !== "put" && operation !== "delete") {
    throw new InvalidMutationError(`mutation.operation must be "put" or "delete", got: ${String(operation)}`);
  }
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidMutationError("mutation.key must be a non-empty string");
  }
  if (operation === "put" && (typeof value !== "string")) {
    throw new InvalidMutationError("mutation.value must be a string for operation 'put'");
  }
  if (operation === "delete" && value !== null) {
    throw new InvalidMutationError("mutation.value must be null for operation 'delete'");
  }
  if (typeof signature !== "string" || signature.length === 0) {
    throw new InvalidMutationError("mutation.signature must be a non-empty string");
  }

  return {
    nodeId:    nodeId as string,
    sequence:  sequence as number,
    timestamp: timestamp as number,
    operation: operation as Operation,
    key:       key as string,
    value:     value as string | null,
    signature: signature as string,
  };
}

// ---------------------------------------------------------------------------
// Version vector helpers
// ---------------------------------------------------------------------------

/**
 * Advance a version vector in-place for a newly applied mutation.
 * Uses max() so the vector only moves forward.
 */
export function advanceVector(vector: VersionVector, m: Pick<Mutation, "nodeId" | "sequence">): void {
  const current = vector[m.nodeId] ?? 0;
  if (m.sequence > current) {
    vector[m.nodeId] = m.sequence;
  }
}

/**
 * Compute the mutation ranges that `they` are missing, given our mutation
 * history and both sides' version vectors.
 *
 * @param ourVector  - The local node's version vector
 * @param theirVector - The remote peer's version vector
 * @returns Array of ranges the remote is missing (in ascending order)
 */
export function getMissingRanges(
  ourVector: Readonly<VersionVector>,
  theirVector: Readonly<VersionVector>,
): Array<{ nodeId: string; from: number; to: number }> {
  const ranges: Array<{ nodeId: string; from: number; to: number }> = [];
  for (const [nodeId, ourHighWater] of Object.entries(ourVector)) {
    const theirHighWater = theirVector[nodeId] ?? 0;
    if (ourHighWater > theirHighWater) {
      ranges.push({ nodeId, from: theirHighWater + 1, to: ourHighWater });
    }
  }
  return ranges;
}
