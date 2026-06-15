import { sql } from "../db/client"
import { assertAutumnFeatureAllowed } from "./entitlements"
import type { ResourceFeature } from "./features"
import { isAutumnConfigured, updateAutumnUsage } from "./autumnClient"

type CountRow = { count: number }

async function activeResourceCount(userId: string, featureId: ResourceFeature) {
  if (featureId === "canvases") {
    const [row] = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM canvases WHERE user_id = ${userId}`
    return Number(row?.count ?? 0)
  }
  if (featureId === "tiles") {
    const [row] = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM tiles WHERE user_id = ${userId} AND deleted_at IS NULL`
    return Number(row?.count ?? 0)
  }
  const [row] = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NULL`
  return Number(row?.count ?? 0)
}

export async function syncAutumnResourceUsage(userId: string, featureId: ResourceFeature) {
  if (!isAutumnConfigured()) return
  const count = await activeResourceCount(userId, featureId)
  await updateAutumnUsage(userId, featureId, count)
}

export async function assertCanCreateAutumnResource(userId: string, featureId: ResourceFeature) {
  if (!isAutumnConfigured()) return
  await syncAutumnResourceUsage(userId, featureId)
  await assertAutumnFeatureAllowed(userId, featureId)
}

export async function syncAutumnResourcesAfterDelete(userId: string, features: ResourceFeature[]) {
  for (const feature of features) {
    await syncAutumnResourceUsage(userId, feature).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[autumn] failed to sync ${feature} usage after delete: ${message}`)
    })
  }
}
