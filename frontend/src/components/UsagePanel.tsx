import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { createApi } from "../api/client"
import type { BillingFeatureUsage, BillingUsage } from "../types"

type GetTokenOptions = { skipCache?: boolean }
type GetToken = (options?: GetTokenOptions) => Promise<string | null>

let cachedUsage: BillingUsage | null = null
let pendingUsage: Promise<BillingUsage> | null = null
const ACCENT_BAR = "#8b5cf6"
const OVER_LIMIT_BAR = "#dc2626"

export function preloadBillingUsage(getToken: GetToken) {
  if (cachedUsage) return Promise.resolve(cachedUsage)
  if (pendingUsage) return pendingUsage

  pendingUsage = createApi(getToken).billing.usage()
    .then((usage) => {
      cachedUsage = usage
      return usage
    })
    .finally(() => {
      pendingUsage = null
    })

  return pendingUsage
}

export function refreshBillingUsage(getToken: GetToken) {
  const request = createApi(getToken).billing.usage()
  const trackedRequest = request
    .then((usage) => {
      cachedUsage = usage
      return usage
    })
    .finally(() => {
      if (pendingUsage === trackedRequest) pendingUsage = null
    })
  pendingUsage = trackedRequest
  return pendingUsage
}

function usageSnapshot(usage: BillingUsage | null) {
  if (!usage) return ""
  return JSON.stringify({
    plans: usage.plans.map((plan) => [plan.id, plan.name, plan.cost]),
    features: usage.features.map((feature) => [
      feature.id,
      feature.used,
      feature.limit,
      feature.remaining,
      feature.unlimited,
      feature.cost,
    ]),
  })
}

function changedFeatureIds(previous: BillingUsage | null, next: BillingUsage) {
  const previousFeatures = new Map(previous?.features.map((feature) => [feature.id, feature]))
  return new Set(next.features
    .filter((feature) => {
      const before = previousFeatures.get(feature.id)
      return !before
        || before.used !== feature.used
        || before.limit !== feature.limit
        || before.remaining !== feature.remaining
        || before.unlimited !== feature.unlimited
        || before.cost !== feature.cost
    })
    .map((feature) => feature.id))
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)
}

function formatUsage(feature: BillingFeatureUsage) {
  const used = formatNumber(feature.used)
  if (feature.limit !== null) return `${used} / ${formatNumber(feature.limit)} ${feature.unit}`
  return `${used} ${feature.unit}`
}

function barPercent(feature: BillingFeatureUsage) {
  if (feature.limit === null || feature.limit <= 0) return 0
  return Math.min(100, Math.max(0, (feature.used / feature.limit) * 100))
}

function barColor(feature: BillingFeatureUsage) {
  // A full bar can simply mean the user is at their cap; red is reserved for actual overage.
  return feature.limit !== null && feature.used > feature.limit ? OVER_LIMIT_BAR : ACCENT_BAR
}

function UsageSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ height: 50, borderBottom: "1px solid #f2f2f2", paddingBottom: 14 }}>
        <div style={{ height: 11, width: 88, borderRadius: 4, background: "#f0f0f0", marginBottom: 8 }} />
        <div style={{ height: 16, width: 150, borderRadius: 4, background: "#f5f5f5" }} />
      </div>
      {[1, 2, 3, 4].map((row) => (
        <div key={row}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
            <div style={{ height: 10, width: 82, borderRadius: 4, background: "#f0f0f0" }} />
            <div style={{ height: 10, width: 58, borderRadius: 4, background: "#f5f5f5" }} />
          </div>
          <div style={{ height: 7, borderRadius: 999, background: "#f4f4f4" }} />
        </div>
      ))}
    </div>
  )
}

function UsageRow({ feature, changed }: { feature: BillingFeatureUsage; changed: boolean }) {
  const percent = barPercent(feature)
  const hasBar = feature.limit !== null && !feature.unlimited

  return (
    <div
      style={{
        padding: "10px 0",
        borderBottom: "1px solid #f5f5f5",
        background: changed ? "#fafafa" : "transparent",
        transition: "background 0.45s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: hasBar ? 7 : 2 }}>
        <p style={{ fontSize: 13, color: "#333", fontWeight: 600 }}>{feature.label}</p>
        <p style={{ fontSize: 11, color: "#999", textAlign: "right", whiteSpace: "nowrap" }}>{formatUsage(feature)}</p>
      </div>

      {hasBar && (
        <div style={{ height: 7, borderRadius: 999, background: "#f0f0f0", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              borderRadius: 999,
              background: barColor(feature),
              transition: "width 0.7s cubic-bezier(0.22,1,0.36,1)",
            }}
          />
        </div>
      )}

    </div>
  )
}

export function UsagePanel({ refreshKey }: { refreshKey: number }) {
  const { getToken } = useAuth()
  const [usage, setUsage] = useState<BillingUsage | null>(cachedUsage)
  const [loading, setLoading] = useState(cachedUsage === null)
  const [error, setError] = useState<string | null>(null)
  const [changedIds, setChangedIds] = useState<Set<BillingFeatureUsage["id"]>>(new Set())

  const planSummary = useMemo(() => {
    if (!usage || usage.plans.length === 0) return null
    const name = usage.plans.map((plan) => plan.name).join(", ")
    const cost = usage.plans.map((plan) => plan.cost).join(" + ")
    return {
      name,
      cost: cost.toLowerCase() === name.toLowerCase() ? null : cost,
    }
  }, [usage])

  async function loadUsage({ forceRefresh }: { forceRefresh: boolean }) {
    setLoading(cachedUsage === null)
    setError(null)
    try {
      const before = cachedUsage
      const next = forceRefresh ? await refreshBillingUsage(getToken) : await preloadBillingUsage(getToken)
      const changed = usageSnapshot(before) === usageSnapshot(next) ? new Set<BillingFeatureUsage["id"]>() : changedFeatureIds(before, next)
      setUsage(next)
      setChangedIds(changed)
      if (changed.size > 0) {
        window.setTimeout(() => setChangedIds(new Set()), 1200)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load usage")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (cachedUsage) {
      setUsage(cachedUsage)
      setLoading(false)
    }
    // Refresh in the background every time the Usage tab mounts; cached data stays visible.
    void loadUsage({ forceRefresh: cachedUsage !== null })
  }, [getToken, refreshKey])

  if (loading) return <UsageSkeleton />

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: 12, color: "#999", lineHeight: 1.45 }}>Usage could not be loaded.</p>
        <button
          onClick={() => loadUsage({ forceRefresh: true })}
          style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 6, border: "none", background: "#1a1a1a", color: "#fff", cursor: "pointer" }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 14, marginBottom: 2 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 7 }}>Current Plan</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 15, color: "#1a1a1a", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {planSummary?.name ?? "No active plan"}
            </p>
            {planSummary?.cost && <p style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{planSummary.cost}</p>}
          </div>
          <button
            type="button"
            onClick={() => { window.location.hash = "plans" }}
            style={{ fontSize: 11, fontWeight: 700, color: "#1a1a1a", background: "#f5f5f5", border: "1px solid #e5e5e5", borderRadius: 6, padding: "6px 9px", cursor: "pointer", flexShrink: 0, transition: "background 0.15s ease, border-color 0.15s ease" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#eee"; e.currentTarget.style.borderColor = "#ddd" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#f5f5f5"; e.currentTarget.style.borderColor = "#e5e5e5" }}
          >
            View plans
          </button>
        </div>
      </div>

      {usage && usage.features.length > 0 ? (
        <div>
          {usage.features.map((feature) => (
            <UsageRow key={feature.id} feature={feature} changed={changedIds.has(feature.id)} />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "#ccc", marginTop: 12 }}>No plan usage available</p>
      )}
    </div>
  )
}
