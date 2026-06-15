import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { checkAutumnFeature, isAutumnConfigured } from "../billing/autumnClient"
import { autumnFeatures, type AutumnFeature } from "../billing/features"
import { activeEntityCounts, getStorageUsage, syncStorageUsageToAutumn } from "../billing/storageUsage"

export const billingRoute = new Hono()

type FeatureUsage = {
  used?: number
  used_bytes?: number
  used_megabytes?: number
  allowed: boolean
  remaining: number | null
  reset_at: string | null
}

function resetAtIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value).toISOString() : null
}

async function autumnBalance(userId: string, featureId: AutumnFeature): Promise<Pick<FeatureUsage, "allowed" | "remaining" | "reset_at">> {
  if (!isAutumnConfigured()) return { allowed: true, remaining: null, reset_at: null }
  const result = await checkAutumnFeature(userId, featureId)
  return {
    allowed: result?.allowed !== false,
    remaining: typeof result?.balance?.remaining === "number" ? result.balance.remaining : null,
    reset_at: resetAtIso(result?.balance?.next_reset_at ?? result?.balance?.nextResetAt),
  }
}

billingRoute.get("/usage", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)

  const [counts, storageUsage] = await Promise.all([
    activeEntityCounts(auth.userId),
    syncStorageUsageToAutumn(auth.userId).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[autumn] failed to sync storage usage during billing poll: ${message}`)
      return getStorageUsage(auth.userId)
    }),
  ])

  const [
    canvasBalance,
    tileBalance,
    thoughtBalance,
    aiBalance,
    transcriptionBalance,
    storageBalance,
  ] = await Promise.all([
    autumnBalance(auth.userId, autumnFeatures.canvases),
    autumnBalance(auth.userId, autumnFeatures.tiles),
    autumnBalance(auth.userId, autumnFeatures.thoughts),
    autumnBalance(auth.userId, autumnFeatures.aiProcessingRequests),
    autumnBalance(auth.userId, autumnFeatures.transcriptionSeconds),
    autumnBalance(auth.userId, autumnFeatures.storage),
  ])

  return c.json({
    customer_id: auth.userId,
    features: {
      canvases: { used: counts.canvases, ...canvasBalance },
      tiles: { used: counts.tiles, ...tileBalance },
      thoughts: { used: counts.thoughts, ...thoughtBalance },
      tags: { used: counts.tags, allowed: true, remaining: null, reset_at: null },
      ai_processing_requests: aiBalance,
      transcription_seconds: transcriptionBalance,
      storage: {
        used_bytes: storageUsage.storageBytes,
        used_megabytes: storageUsage.storageMegabytes,
        ...storageBalance,
      },
    },
  })
})
