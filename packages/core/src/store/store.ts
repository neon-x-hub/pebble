import { EventEmitter } from "node:events";
import type { Mutation, VersionVector, Identity } from "@pebbl/types";
import {
  InvalidSignatureError,
  InvalidMutationError,
  SequenceCollisionError,
  UnknownNodeError,
} from "@pebbl/types";
import { verifyMutation } from "@pebbl/crypto";
import {
  createMutation,
  mutationId,
  validateMutationStructure,
  advanceVector,
  getMissingRanges,
} from "./mutation.js";
import { winner } from "./conflict.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolves a nodeId to its hex-encoded Ed25519 public key.
 * Returns `undefined` if the node is not recognised (not in the cluster config).
 * The Store does not depend directly on ClusterConfig — the caller injects
 * this resolver so the Store remains decoupled from network configuration.
 */
export type PublicKeyResolver = (nodeId: string) => string | undefined;

export interface ApplyOptions {
  /**
   * Skip Ed25519 signature verification.
   * ONLY set to `true` when replaying mutations from the trusted local log
   * during startup recovery. Never set for mutations received from peers or clients.
   */
  skipSignatureVerification?: boolean;
  /**
   * Resolves nodeId → hex public key for signature verification.
   * Required unless `skipSignatureVerification` is true.
   */
  publicKeyResolver?: PublicKeyResolver;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * The in-memory state machine of a Pebble node.
 *
 * Responsibilities:
 * - Maintain the current winning mutation per key (`currentState`)
 * - Maintain the full mutation history (`history`) for gossip sync
 * - Track the version vector (`versionVector`) for incremental sync
 * - Manage the local sequence counter for new mutations
 * - Enforce invariants: no invalid signatures, no duplicates, no collisions
 *
 * The Store emits events so callers can react (e.g. persist to log, gossip):
 * - `"mutation:applied"` — a mutation was accepted and changed state
 * - `"mutation:rejected"` — a mutation was rejected (event carries the Error)
 *
 * The Store is deliberately I/O-free. Callers (the Pebble class) handle
 * persistence by listening to events.
 */
export class Store extends EventEmitter {
  /** Key → winning mutation (may be a tombstone for deleted keys). */
  private readonly currentState = new Map<string, Mutation>();
  /** mutationId → full mutation. Retained forever (v0.1: no GC). */
  private readonly history = new Map<string, Mutation>();
  /** Tracks the highest sequence seen from each nodeId. */
  private readonly versionVector: VersionVector = {};
  /** Next sequence number for locally-created mutations. */
  private nextLocalSequence: number;

  constructor(private readonly nodeId: string, initialSequence = 1) {
    super();
    this.nextLocalSequence = initialSequence;
  }

  // ---------------------------------------------------------------------------
  // Local writes
  // ---------------------------------------------------------------------------

  /**
   * Create, sign, and apply a local put mutation.
   * @returns The new mutation (already applied to local state)
   */
  localPut(
    key: string,
    value: string,
    identity: Identity,
    opts?: { timestamp?: number },
  ): Mutation {
    const m = createMutation({
      identity,
      sequence: this.nextLocalSequence++,
      operation: "put",
      key,
      value,
      timestamp: opts?.timestamp,
    });
    // Apply with signature verification skipped — we just created and signed it
    this._applyTrusted(m);
    return m;
  }

  /**
   * Create, sign, and apply a local delete (tombstone) mutation.
   * @returns The new mutation (already applied to local state)
   */
  localDelete(key: string, identity: Identity, opts?: { timestamp?: number }): Mutation {
    const m = createMutation({
      identity,
      sequence: this.nextLocalSequence++,
      operation: "delete",
      key,
      value: null,
      timestamp: opts?.timestamp,
    });
    this._applyTrusted(m);
    return m;
  }

  // ---------------------------------------------------------------------------
  // Apply (external mutations: from peers or recovery)
  // ---------------------------------------------------------------------------

  /**
   * Validate and apply an arbitrary mutation to local state.
   *
   * Pipeline:
   * 1. Structural validation
   * 2. Duplicate check (idempotent if already seen)
   * 3. Sequence collision check (error if same ID, different content)
   * 4. Signature verification (unless skipped for trusted recovery)
   * 5. LWW conflict resolution
   * 6. State + history + vector update
   * 7. Emit event
   *
   * @param raw  - Any value; structural validation runs first
   * @param opts - Resolver and optional signature bypass
   * @returns `true` if the mutation changed current state, `false` if it lost LWW
   * @throws InvalidMutationError | InvalidSignatureError | SequenceCollisionError | UnknownNodeError
   */
  applyMutation(raw: unknown, opts: ApplyOptions): boolean {
    // 1. Structural validation
    const m = validateMutationStructure(raw);
    const mid = mutationId(m);

    // 2. Duplicate check — idempotent
    const existing = this.history.get(mid);
    if (existing !== undefined) {
      // 3. Collision: same ID, different content → security violation
      if (!this._contentEqual(existing, m)) {
        const err = new SequenceCollisionError(
          `Sequence collision for ${mid}: mutation content differs from known record`,
        );
        this.emit("mutation:rejected", m, err);
        throw err;
      }
      // Exact duplicate — already applied, nothing to do
      return false;
    }

    // 4. Signature verification
    if (!opts.skipSignatureVerification) {
      const resolver = opts.publicKeyResolver;
      if (resolver === undefined) {
        throw new InvalidMutationError(
          "publicKeyResolver is required when skipSignatureVerification is not set",
        );
      }
      const pubKey = resolver(m.nodeId);
      if (pubKey === undefined) {
        const err = new UnknownNodeError(`Unknown nodeId in mutation: "${m.nodeId}"`);
        this.emit("mutation:rejected", m, err);
        throw err;
      }
      if (!verifyMutation(pubKey, m)) {
        const err = new InvalidSignatureError(
          `Invalid signature on mutation ${mid}`,
        );
        this.emit("mutation:rejected", m, err);
        throw err;
      }
    }

    // 5–7. Apply
    this._commit(m);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Read access
  // ---------------------------------------------------------------------------

  /**
   * Look up the current value for a key.
   * Returns `undefined` if the key does not exist or has been deleted.
   */
  get(key: string): string | undefined {
    const m = this.currentState.get(key);
    if (m === undefined || m.operation === "delete") return undefined;
    return m.value ?? undefined;
  }

  /** Whether a key currently exists (not deleted). */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** All currently live (non-tombstoned) keys. */
  keys(): string[] {
    const result: string[] = [];
    for (const [key, m] of this.currentState) {
      if (m.operation === "put") result.push(key);
    }
    return result;
  }

  /** All currently live key-value pairs. */
  entries(): Array<[string, string]> {
    const result: Array<[string, string]> = [];
    for (const [key, m] of this.currentState) {
      if (m.operation === "put" && m.value !== null) {
        result.push([key, m.value]);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Gossip helpers
  // ---------------------------------------------------------------------------

  /** A snapshot of the current version vector. */
  getVersionVector(): Readonly<VersionVector> {
    return { ...this.versionVector };
  }

  /**
   * Compute the ranges the remote peer is missing.
   * @param theirVector - The peer's version vector from their DIGEST message
   */
  computeMissingRanges(
    theirVector: Readonly<VersionVector>,
  ): Array<{ nodeId: string; from: number; to: number }> {
    return getMissingRanges(this.versionVector, theirVector);
  }

  /**
   * Retrieve all mutations that fall within the given ranges.
   * Used to construct a MUTATIONS response.
   */
  getMutationsInRanges(
    ranges: ReadonlyArray<{ nodeId: string; from: number; to: number }>,
  ): Mutation[] {
    const result: Mutation[] = [];
    for (const range of ranges) {
      for (let seq = range.from; seq <= range.to; seq++) {
        const m = this.history.get(`${range.nodeId}:${seq}`);
        if (m !== undefined) result.push(m);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Snapshot support
  // ---------------------------------------------------------------------------

  /**
   * Export current state for snapshot serialization.
   * Includes tombstones so the snapshot faithfully represents deletions.
   */
  exportState(): ReadonlyMap<string, Mutation> {
    return this.currentState;
  }

  /**
   * Import state from a snapshot. Replaces current state entirely.
   * Call only during startup before log replay; never on a live store.
   */
  importSnapshot(state: Map<string, Mutation>, vector: VersionVector, sequence: number): void {
    this.currentState.clear();
    this.history.clear();
    for (const [key, m] of state) {
      this.currentState.set(key, m);
      this.history.set(mutationId(m), m);
    }
    Object.assign(this.versionVector, vector);
    this.nextLocalSequence = sequence;
  }

  /** Current next local sequence number (used during metadata saves). */
  getNextLocalSequence(): number {
    return this.nextLocalSequence;
  }

  /** Set the next local sequence (used after recovery). */
  setNextLocalSequence(seq: number): void {
    this.nextLocalSequence = seq;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Apply a trusted mutation (locally created or verified by the caller).
   * Bypasses all validation. Only used for `localPut` / `localDelete`.
   */
  private _applyTrusted(m: Mutation): void {
    this._commit(m);
    this.emit("mutation:applied", m);
  }

  /**
   * Commit a mutation to history, advance the version vector, and update
   * the current state via LWW conflict resolution.
   *
   * @returns `true` if the current state for `m.key` changed
   */
  private _commit(m: Mutation): boolean {
    const mid = mutationId(m);
    this.history.set(mid, m);
    advanceVector(this.versionVector, m);

    const incumbent = this.currentState.get(m.key);
    const wins = incumbent === undefined || winner(incumbent, m) === m;

    if (wins) {
      this.currentState.set(m.key, m);
    }

    this.emit("mutation:applied", m);
    return wins;
  }

  /**
   * Check if two mutations with the same ID have identical content.
   * Used to distinguish legitimate duplicates from sequence collisions.
   */
  private _contentEqual(a: Mutation, b: Mutation): boolean {
    return (
      a.nodeId    === b.nodeId    &&
      a.sequence  === b.sequence  &&
      a.timestamp === b.timestamp &&
      a.operation === b.operation &&
      a.key       === b.key       &&
      a.value     === b.value     &&
      a.signature === b.signature
    );
  }
}
