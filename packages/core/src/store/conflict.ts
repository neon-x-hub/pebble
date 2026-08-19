import type { Mutation } from "@pebbl/types";

/**
 * Compare two mutations targeting the same key using last-write-wins (LWW).
 *
 * Returns a positive number if `a` wins, negative if `b` wins, zero if equal.
 *
 * Ordering rules (deterministic, no coordination required):
 *   1. Higher `timestamp` wins
 *   2. On tie: lexicographically later `nodeId` wins (arbitrary but stable)
 *
 * All nodes apply the same function, so given the same set of mutations,
 * every node independently computes the same winner.
 *
 * Clock note (v0.1 limitation): physical wall-clock timestamps are used.
 * Clock skew can influence outcomes. Future versions may use Hybrid Logical
 * Clocks (HLC) to capture causality more precisely.
 */
export function compare(a: Mutation, b: Mutation): number {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }
  if (a.nodeId !== b.nodeId) {
    return a.nodeId.localeCompare(b.nodeId);
  }
  return a.sequence - b.sequence;
}

/**
 * Return the winning mutation when two mutations target the same key.
 * The result is the mutation that should be reflected in the current state.
 *
 * @param incumbent - The mutation currently stored for this key
 * @param challenger - The new mutation being applied
 * @returns The mutation that should win (incumbent if it outranks challenger)
 */
export function winner(incumbent: Mutation, challenger: Mutation): Mutation {
  return compare(challenger, incumbent) > 0 ? challenger : incumbent;
}
