import { sql } from "../db/client"
import type postgres from "postgres"
import { assertAutumnFeatureAllowed } from "./entitlements"
import type { ResourceFeature } from "./features"
import { getOrCreateAutumnCustomer, isAutumnConfigured, updateAutumnUsage } from "./autumnClient"
import { publishResourceUsageCounts, type ResourceUsageCounts } from "./resourceReconciliation"

type CountRow = { count: number }
export type ResourceQueryClient = typeof sql | postgres.TransactionSql

export const RESOURCE_FEATURES: readonly ResourceFeature[] = ["canvases", "tiles", "thoughts"]

async function activeResourceCount(query: ResourceQueryClient, userId: string, featureId: ResourceFeature) {
  if (featureId === "canvases") {
    const [row] = await query<CountRow[]>`SELECT COUNT(*)::int AS count FROM canvases WHERE user_id = ${userId}`
    return Number(row?.count ?? 0)
  }
  if (featureId === "tiles") {
    const [row] = await query<CountRow[]>`SELECT COUNT(*)::int AS count FROM tiles WHERE user_id = ${userId} AND deleted_at IS NULL`
    return Number(row?.count ?? 0)
  }
  const [row] = await query<CountRow[]>`SELECT COUNT(*)::int AS count FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NULL`
  return Number(row?.count ?? 0)
}

export async function reconcileAutumnResourceUsage(
  userId: string,
  features: readonly ResourceFeature[] = RESOURCE_FEATURES,
  options: { counts?: ResourceUsageCounts; ensureCustomer?: boolean; query?: ResourceQueryClient } = {},
) {
  const query = options.query ?? sql
  const entries = await Promise.all(features.map(async (feature) => {
    const knownCount = options.counts?.[feature]
    return [feature, knownCount ?? await activeResourceCount(query, userId, feature)] as const
  }))
  const counts = Object.fromEntries(entries) as ResourceUsageCounts
  if (!isAutumnConfigured()) return counts

  if (options.ensureCustomer !== false) await getOrCreateAutumnCustomer(userId)
  await publishResourceUsageCounts(userId, counts, features, (customerId, feature, usage) => {
    return updateAutumnUsage(customerId, feature, usage, { ensureCustomer: false })
  })
  return counts
}

async function assertCanCreateAutumnResource(query: ResourceQueryClient, userId: string, featureId: ResourceFeature) {
  if (!isAutumnConfigured()) return
  await reconcileAutumnResourceUsage(userId, [featureId], { query })
  await assertAutumnFeatureAllowed(userId, featureId)
}

export async function reconcileAutumnResourcesAfterMutation(userId: string, features: readonly ResourceFeature[]) {
  await reconcileAutumnResourceUsage(userId, features).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[autumn] failed to reconcile ${features.join(", ")} usage after mutation: ${message}`)
  })
}

export async function createSerializedBillableResource<T>(
  userId: string,
  featureId: ResourceFeature,
  create: (transaction: postgres.TransactionSql) => Promise<T>,
) {
  // The transaction-level advisory lock serializes count-changing requests for
  // this user and feature across every backend instance.
  const result = await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${featureId}`}, 0))`
    await assertCanCreateAutumnResource(transaction, userId, featureId)
    return create(transaction)
  })
  await reconcileAutumnResourcesAfterMutation(userId, [featureId])
  return result
}
