import { useEffect, useState } from "react"
import { useStore } from "../store"
import type { BillingOverageItem, BillingPlanImpact, BillingPlanOption } from "../types"
import { ModalShell } from "./ModalShell"

const RESOURCE_WORDS: Record<BillingOverageItem["id"], { singular: string; plural: string }> = {
  canvases: { singular: "canvas", plural: "canvases" },
  tiles: { singular: "tile", plural: "tiles" },
  thoughts: { singular: "thought", plural: "thoughts" },
}

const RESOURCE_NAMES: Record<BillingOverageItem["id"], string> = {
  canvases: "Canvases",
  tiles: "Tiles",
  thoughts: "Thoughts",
}

function resourceWord(id: BillingOverageItem["id"], value: number) {
  const words = RESOURCE_WORDS[id]
  return value === 1 ? words.singular : words.plural
}

function joinWords(words: string[]) {
  if (words.length <= 1) return words[0] ?? ""
  if (words.length === 2) return `${words[0]} and ${words[1]}`
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`
}

function actionLabel(plan: BillingPlanOption) {
  if (plan.action === "current") return "Current plan"
  if (plan.action === "scheduled") return "Plan scheduled"
  if (plan.action === "upgrade") return `Upgrade to ${plan.name}`
  if (plan.action === "downgrade") return plan.id === "free" ? "Switch to Free" : `Switch to ${plan.name}`
  return `Choose ${plan.name}`
}

function PlanCard({ plan, busy, onSelect }: { plan: BillingPlanOption; busy: boolean; onSelect: (plan: BillingPlanOption) => void }) {
  const disabled = busy || plan.action === "current" || plan.action === "scheduled" || plan.action === "unavailable"

  return (
    <section style={{ border: "1px solid #e5e5e5", borderRadius: 8, background: plan.action === "current" ? "#ffffff" : "#fbfbfd", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: 14, borderBottom: "1px solid #eee" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, lineHeight: 1.25, fontWeight: 700, color: "#1a1a1a" }}>{plan.name}</h3>
          {plan.action === "current" && <span style={{ fontSize: 10, color: "#4c1d95", fontWeight: 700 }}>Current</span>}
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "#333", fontWeight: 700 }}>{plan.cost}</p>
        {plan.description && <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.4, color: "#777" }}>{plan.description}</p>}
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
        {plan.features.length > 0 ? plan.features.map((feature) => (
          <div key={feature.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, borderBottom: "1px solid #f2f2f2", paddingBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#555", fontWeight: 600 }}>{feature.label}</span>
            <span style={{ fontSize: 11, color: "#1a1a1a", textAlign: "right", lineHeight: 1.35 }}>{feature.display}</span>
          </div>
        )) : (
          <p style={{ margin: 0, fontSize: 12, color: "#999", lineHeight: 1.45 }}>No plan limits returned by Autumn.</p>
        )}
      </div>

      <div style={{ padding: 14, background: "#fff", borderTop: "1px solid #eee" }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect(plan)}
          style={{
            width: "100%",
            minHeight: 34,
            borderRadius: 7,
            border: disabled ? "1px solid #e5e5e5" : "none",
            background: disabled ? "#f8f8f8" : "#1a1a1a",
            color: disabled ? "#999" : "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: disabled ? "default" : "pointer",
          }}
        >
          {busy ? "Working..." : actionLabel(plan)}
        </button>
      </div>
    </section>
  )
}

function PlanChangeConfirmModal({ impact, busy, onCancel, onConfirm }: { impact: BillingPlanImpact; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const hasOverages = impact.blocking_overages.length > 0

  return (
    <ModalShell
      titleId="billing-plan-confirm-title"
      title={`Switch to ${impact.target_plan_name}?`}
      subtitle={hasOverages
        ? "This plan has lower limits than your current usage."
        : "This plan has lower limits than your current plan."}
      width="min(500px, calc(100vw - 32px))"
      onClose={onCancel}
      closeOnBackdrop={!busy}
      footer={(
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            style={{ height: 34, padding: "0 12px", borderRadius: 7, border: "1px solid #d4d4d8", background: "#ffffff", color: "#333", fontSize: 13, fontWeight: 700, opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}
          >
            Keep current plan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            style={{ height: 34, padding: "0 12px", borderRadius: 7, border: "none", background: "#1a1a1a", color: "#fff", fontSize: 13, fontWeight: 700, opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}
          >
            {busy ? "Switching..." : "Switch anyway"}
          </button>
        </>
      )}
    >
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7, color: "#333", fontSize: 13, lineHeight: 1.4 }}>
        {impact.blocking_overages.map((item) => (
          <li key={item.id}>
            You are using {item.used} {resourceWord(item.id, item.used)}, but {impact.target_plan_name} allows {item.limit}. Delete {item.over_by} {resourceWord(item.id, item.over_by)}.
          </li>
        ))}
      </ul>
      {impact.at_limit_resources.length > 0 && (
        <p style={{ margin: 0, color: "#555", fontSize: 13, lineHeight: 1.45 }}>
          You're using exactly the lower plan's limit for {joinWords(impact.at_limit_resources.map((id) => RESOURCE_NAMES[id]))}, so you won't be able to create new {joinWords(impact.at_limit_resources.map((id) => RESOURCE_WORDS[id].plural))} after switching.
        </p>
      )}
      {hasOverages && (
        <p style={{ margin: 0, color: "#555", fontSize: 13, lineHeight: 1.45 }}>
          If you switch anyway, no data is deleted. You will need to remove the extra canvases, tiles, or thoughts before you can continue using the app normally.
        </p>
      )}
      {!hasOverages && (
        <p style={{ margin: 0, color: "#555", fontSize: 13, lineHeight: 1.45 }}>
          If you switch anyway, no data is deleted and your existing items remain editable.
        </p>
      )}
    </ModalShell>
  )
}

export function PlansModal({ onClose }: { onClose: () => void }) {
  const plans = useStore((state) => state.billingPlans)
  const loading = useStore((state) => state.billingPlansLoading)
  const billingPlansError = useStore((state) => state.billingPlansError)
  const preloadPlans = useStore((state) => state.preloadBillingPlans)
  const refreshPlans = useStore((state) => state.refreshBillingPlans)
  const previewImpact = useStore((state) => state.previewBillingPlanImpact)
  const switchPlan = useStore((state) => state.switchBillingPlan)
  const [localError, setLocalError] = useState<string | null>(null)
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const [confirmImpact, setConfirmImpact] = useState<BillingPlanImpact | null>(null)
  const error = localError ?? billingPlansError

  async function loadPlans({ forceRefresh }: { forceRefresh: boolean }) {
    setLocalError(null)
    try {
      await (forceRefresh ? refreshPlans() : preloadPlans())
    } catch (loadError) {
      setLocalError(loadError instanceof Error ? loadError.message : "Unable to load plans")
    }
  }

  async function completeSwitch(planId: string, confirmedOverLimit = false) {
    setBusyPlanId(planId)
    setLocalError(null)
    try {
      const result = await switchPlan(planId, confirmedOverLimit)
      if (result.payment_url) {
        window.location.href = result.payment_url
        return
      }
      setConfirmImpact(null)
    } catch (switchError) {
      setLocalError(switchError instanceof Error ? switchError.message : "Unable to switch plans")
    } finally {
      setBusyPlanId(null)
    }
  }

  async function selectPlan(plan: BillingPlanOption) {
    if (plan.action === "downgrade") {
      setBusyPlanId(plan.id)
      setLocalError(null)
      try {
        const impact = await previewImpact(plan.id)
        if (impact.blocking_overages.length > 0 || impact.at_limit_resources.length > 0) {
          setConfirmImpact(impact)
          return
        }
      } catch (impactError) {
        setLocalError(impactError instanceof Error ? impactError.message : "Unable to preview plan change")
        return
      } finally {
        setBusyPlanId(null)
      }
    }
    await completeSwitch(plan.id)
  }

  useEffect(() => {
    // Opening the plans page should revalidate pricing instead of reusing an
    // older snapshot so the user sees the latest plan state.
    void loadPlans({ forceRefresh: true })
  }, [preloadPlans, refreshPlans])

  return (
    <>
      <ModalShell
        titleId="billing-plans-title"
        title="Plans"
        subtitle="All prices are in USD."
        width="min(960px, calc(100vw - 32px))"
        onClose={onClose}
        closeOnBackdrop={busyPlanId === null}
        footer={(
          <button
            type="button"
            disabled={busyPlanId !== null}
            onClick={onClose}
            style={{ height: 34, padding: "0 12px", borderRadius: 7, border: "1px solid #d4d4d8", background: "#ffffff", color: "#333", fontSize: 13, fontWeight: 700, opacity: busyPlanId === null ? 1 : 0.55, cursor: busyPlanId === null ? "pointer" : "default" }}
          >
            Close
          </button>
        )}
      >
        {error && <p style={{ margin: 0, color: "#b91c1c", fontSize: 12, lineHeight: 1.45 }}>{error}</p>}
        {loading && <p style={{ margin: 0, color: "#777", fontSize: 13 }}>Loading plans...</p>}
        {!loading && plans?.plans.length === 0 && <p style={{ margin: 0, color: "#777", fontSize: 13 }}>No plans were returned by Autumn.</p>}
        {!loading && plans && plans.plans.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            {plans.plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} busy={busyPlanId === plan.id} onSelect={selectPlan} />
            ))}
          </div>
        )}
        <p style={{ margin: 0, color: "#777", fontSize: 11, lineHeight: 1.45 }}>
          If you are experiencing financial hardship, email us anonymously at MindSupportTeam@pm.me and we can discuss options.
        </p>
      </ModalShell>

      {confirmImpact && (
        <PlanChangeConfirmModal
          impact={confirmImpact}
          busy={busyPlanId === confirmImpact.target_plan_id}
          onCancel={() => setConfirmImpact(null)}
          onConfirm={() => completeSwitch(confirmImpact.target_plan_id, true)}
        />
      )}
    </>
  )
}
