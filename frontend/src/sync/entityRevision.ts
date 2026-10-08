import { syncDb } from "./localDb"
import type { SyncEntityType } from "./types"

// Keep these outside entity records: a deletion must retain its revision too.
function revisionKey(type: SyncEntityType, serverId: number) {
  return `entityRevision:${type}:${serverId}`
}

export async function readEntityRevision(type: SyncEntityType, serverId: number | null) {
  if (serverId === null) return 0
  const record = await syncDb.metadata.get(revisionKey(type, serverId))
  return typeof record?.value === "number" ? record.value : 0
}

export async function advanceRevision(key: string, revision: number) {
  const record = await syncDb.metadata.get(key)
  const current = typeof record?.value === "number" ? record.value : 0
  if (revision > current) await syncDb.metadata.put({ key, value: revision })
}

// Call within the same IndexedDB transaction as the entity mutation.
export async function writeEntityRevision(type: SyncEntityType, serverId: number | null, revision: number | null) {
  if (serverId !== null && revision !== null) await advanceRevision(revisionKey(type, serverId), revision)
}
