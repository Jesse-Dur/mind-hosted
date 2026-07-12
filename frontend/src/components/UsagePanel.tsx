// This file owns the usage view only; startup and preload orchestration live elsewhere.
import { useEffect, useMemo } from "react"
import { useStore } from "../store"
import type { BillingFeatureUsage } from "../types"
import { startBillingWarmupOnPlans } from "../startup/workspaceStartup"
const ACCENT_BAR = "#8b5cf6"
const OVER_LIMIT_BAR = "#dc2626"

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

function UsageRow({ feature, changed }: { feature: BillingFeatureUsage; changed: boolean }) {
  const percent = barPercent(feature)
  const hasBar = feature.limit !== null && !feature.unlimited
  const overLimit = feature.limit !== null && feature.used > feature.limit

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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <p style={{ fontSize: 11, color: "#999", textAlign: "right", whiteSpace: "nowrap" }}>{formatUsage(feature)}</p>
          {overLimit && (
            <p style={{ fontSize: 10.5, fontWeight: 700, color: "#b91c1c", textAlign: "right" }}>
              Over limit
            </p>
          )}
        </div>
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

export function UsagePanel() {
  const usage = useStore((state) => state.billingUsage)
  const loading = useStore((state) => state.billingUsageLoading)
  const error = useStore((state) => state.billingUsageError)
  const changedIds = useStore((state) => state.billingChangedFeatureIds)
  const refreshUsage = useStore((state) => state.refreshBillingUsage)

  useEffect(() => {
    void startBillingWarmupOnPlans()
  }, [])

  const planSummary = useMemo(() => {
    if (!usage || usage.plans.length === 0) return null
    const name = usage.plans.map((plan) => plan.name).join(", ")
    const cost = usage.plans.map((plan) => plan.cost).join(" + ")
    return {
      name,
      cost: cost.toLowerCase() === name.toLowerCase() ? null : cost,
    }
  }, [usage])

  if (loading && usage === null) return null

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: 12, color: "#999", lineHeight: 1.45 }}>Usage could not be loaded.</p>
        <button
          onClick={() => { void refreshUsage().catch(console.error) }}
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
          >
            View plans
          </button>
        </div>
      </div>

      {usage && usage.features.length > 0 ? (
        <div>
          {usage.features.map((feature) => (
            <UsageRow
              key={feature.id}
              feature={feature}
              changed={changedIds.has(feature.id)}
            />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "#ccc", marginTop: 12 }}>No plan usage available</p>
      )}
    </div>
  )
}
