import { entityKey } from "./ids"
import type { SyncEntityType } from "./types"

let generation = 0
const entityGenerations = new Map<string, number>()

/**
 * Snapshot responses are allowed to arrive after newer local or server writes.
 * This in-memory generation fence lets the snapshot cache ignore only writes
 * that happened after that particular request began.
 */
export function captureEntityWriteGeneration() {
  return generation
}

export function markEntityWrite(entityType: SyncEntityType, clientId: string) {
  generation += 1
  entityGenerations.set(entityKey(entityType, clientId), generation)
}

export function entityWasWrittenAfter(entityType: SyncEntityType, clientId: string, snapshotGeneration: number) {
  return (entityGenerations.get(entityKey(entityType, clientId)) ?? 0) > snapshotGeneration
}
