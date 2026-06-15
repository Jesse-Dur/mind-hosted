import { sql } from "../db/client"
import type { Canvas, Tag, Thought, Tile } from "../types"
import { updateAutumnUsage } from "./autumnClient"
import { autumnFeatures } from "./features"
import { estimateCanvasStorage, estimateTagStorage, estimateThoughtStorage, estimateTileStorage } from "./storageEstimate"

type UsageRow = {
  storage_bytes: number | string
  storage_synced_bytes: number | string
  storage_synced_at: string | null
}

type CountRow = { count: number }

export type StorageUsage = {
  storageBytes: number
  storageMegabytes: number
  storageSyncedBytes: number
  storageSyncedAt: string | null
}

export function storageMegabytes(storageBytes: number) {
  return storageBytes <= 0 ? 0 : Math.ceil(storageBytes / 1_000_000)
}

function normalizeUsageRow(row: UsageRow | undefined): StorageUsage {
  const storageBytes = Number(row?.storage_bytes ?? 0)
  const storageSyncedBytes = Number(row?.storage_synced_bytes ?? 0)
  return {
    storageBytes,
    storageMegabytes: storageMegabytes(storageBytes),
    storageSyncedBytes,
    storageSyncedAt: row?.storage_synced_at ?? null,
  }
}

export async function getStorageUsage(userId: string) {
  const [row] = await sql<UsageRow[]>`
    INSERT INTO user_usage (user_id)
    VALUES (${userId})
    ON CONFLICT (user_id) DO UPDATE SET updated_at = user_usage.updated_at
    RETURNING storage_bytes, storage_synced_bytes, storage_synced_at
  `
  return normalizeUsageRow(row)
}

export async function addStorageDelta(userId: string, deltaBytes: number) {
  if (deltaBytes === 0) return getStorageUsage(userId)
  const [row] = await sql<UsageRow[]>`
    INSERT INTO user_usage (user_id, storage_bytes)
    VALUES (${userId}, ${Math.max(0, deltaBytes)})
    ON CONFLICT (user_id) DO UPDATE
    SET storage_bytes = GREATEST(0, user_usage.storage_bytes + ${deltaBytes}),
        updated_at = NOW()
    RETURNING storage_bytes, storage_synced_bytes, storage_synced_at
  `
  return normalizeUsageRow(row)
}

export async function syncStorageUsageToAutumn(userId: string) {
  const usage = await getStorageUsage(userId)
  await updateAutumnUsage(userId, autumnFeatures.storage, usage.storageMegabytes)
  const [row] = await sql<UsageRow[]>`
    UPDATE user_usage
    SET storage_synced_bytes = storage_bytes,
        storage_synced_at = NOW(),
        updated_at = NOW()
    WHERE user_id = ${userId}
    RETURNING storage_bytes, storage_synced_bytes, storage_synced_at
  `
  return normalizeUsageRow(row)
}

export async function recalculateUserStorage(userId: string) {
  const [canvases, tiles, thoughts, tags] = await Promise.all([
    sql<Canvas[]>`SELECT * FROM canvases WHERE user_id = ${userId}`,
    sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND deleted_at IS NULL`,
    sql<Thought[]>`SELECT * FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NULL`,
    sql<Tag[]>`SELECT * FROM tags WHERE user_id = ${userId}`,
  ])
  const storageBytes = [
    ...canvases.map(estimateCanvasStorage),
    ...tiles.map(estimateTileStorage),
    ...thoughts.map(estimateThoughtStorage),
    ...tags.map(estimateTagStorage),
  ].reduce((total, bytes) => total + bytes, 0)

  const [row] = await sql<UsageRow[]>`
    INSERT INTO user_usage (user_id, storage_bytes)
    VALUES (${userId}, ${storageBytes})
    ON CONFLICT (user_id) DO UPDATE
    SET storage_bytes = ${storageBytes},
        updated_at = NOW()
    RETURNING storage_bytes, storage_synced_bytes, storage_synced_at
  `
  return normalizeUsageRow(row)
}

export async function activeEntityCounts(userId: string) {
  const [canvases, tiles, thoughts, tags] = await Promise.all([
    sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM canvases WHERE user_id = ${userId}`,
    sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM tiles WHERE user_id = ${userId} AND deleted_at IS NULL`,
    sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NULL`,
    sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM tags WHERE user_id = ${userId}`,
  ])

  return {
    canvases: Number(canvases[0]?.count ?? 0),
    tiles: Number(tiles[0]?.count ?? 0),
    thoughts: Number(thoughts[0]?.count ?? 0),
    tags: Number(tags[0]?.count ?? 0),
  }
}
