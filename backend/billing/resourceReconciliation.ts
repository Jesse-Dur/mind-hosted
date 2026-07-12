// How are authoritative database counts published to the billing provider?
// Publishing absolute values makes repeated reconciliation safe after retries or customer recreation.

import type { ResourceFeature } from "./features"

export type ResourceUsageCounts = Partial<Record<ResourceFeature, number>>

export async function publishResourceUsageCounts(
  userId: string,
  counts: ResourceUsageCounts,
  features: readonly ResourceFeature[],
  update: (userId: string, feature: ResourceFeature, usage: number) => Promise<unknown>,
) {
  await Promise.all(features.map(async (feature) => {
    const usage = counts[feature]
    if (usage === undefined) throw new Error(`Missing authoritative ${feature} count`)
    await update(userId, feature, usage)
  }))
}
