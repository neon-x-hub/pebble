import type { Mutation } from "@pebbl/types";
import { Store } from "../store/store.js";
import { MutationLog } from "./log.js";
import { loadLatestSnapshot } from "./snapshot.js";
import { loadMetadata } from "./metadata.js";

export interface RecoveryResult {
  recoveredMutationsCount: number;
  snapshotLoaded: boolean;
}

/**
 * Recover store state on node startup:
 * 1. Load latest snapshot if available.
 * 2. Load metadata if available.
 * 3. Replay mutations from mutation log with skipSignatureVerification: true.
 * 4. Sync store local sequence counter with highest seen local sequence + 1.
 */
export async function recover(
  dataDir: string,
  store: Store,
  nodeId: string,
): Promise<RecoveryResult> {
  const snapshot = await loadLatestSnapshot(dataDir);
  const metadata = await loadMetadata(dataDir);

  let snapshotLoaded = false;
  let nextSequence = metadata.nextLocalSequence || 1;

  if (snapshot) {
    const stateMap = new Map<string, Mutation>();
    for (const [k, v] of Object.entries(snapshot.state)) {
      stateMap.set(k, v);
    }
    store.importSnapshot(stateMap, snapshot.versionVector, snapshot.nextLocalSequence);
    nextSequence = Math.max(nextSequence, snapshot.nextLocalSequence);
    snapshotLoaded = true;
  } else {
    store.setNextLocalSequence(nextSequence);
  }

  const log = new MutationLog(dataDir);
  const logMutations = await log.readAll();
  let recoveredMutationsCount = 0;

  for (const mutation of logMutations) {
    // Replay log mutations (trusted because they were written to our own local disk)
    store.applyMutation(mutation, { skipSignatureVerification: true });
    recoveredMutationsCount++;

    if (mutation.nodeId === nodeId) {
      nextSequence = Math.max(nextSequence, mutation.sequence + 1);
    }
  }

  store.setNextLocalSequence(nextSequence);

  return {
    recoveredMutationsCount,
    snapshotLoaded,
  };
}
