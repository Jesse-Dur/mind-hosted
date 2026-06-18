import type { AutumnFeature } from "./features"

const DEFAULT_AUTUMN_API_BASE = "https://api.useautumn.com"
const AUTUMN_API_VERSION = "2.3.0"

type AutumnBalance = {
  feature_id?: string
  remaining?: number
  next_reset_at?: number | null
  featureId?: string
  nextResetAt?: number | null
}

export type AutumnCheckResponse = {
  allowed?: boolean
  balance?: AutumnBalance | null
}

export type AutumnCustomerBalance = {
  featureId?: string
  feature_id?: string
  granted?: number | null
  remaining?: number | null
  usage?: number | null
  unlimited?: boolean | null
  nextResetAt?: number | null
  next_reset_at?: number | null
}

export type AutumnCustomerPlanRef = {
  planId?: string
  plan_id?: string
  status?: string
  pastDue?: boolean | null
  past_due?: boolean | null
  canceledAt?: string | number | null
  canceled_at?: string | number | null
  expiresAt?: string | number | null
  expires_at?: string | number | null
  currentPeriodEnd?: string | number | null
  current_period_end?: string | number | null
}

export type AutumnCustomerResponse = {
  subscriptions?: AutumnCustomerPlanRef[]
  purchases?: AutumnCustomerPlanRef[]
  balances?: Record<string, AutumnCustomerBalance>
}

export type AutumnPlanPriceDisplay = {
  primaryText?: string
  primary_text?: string
  secondaryText?: string
  secondary_text?: string
}

export type AutumnPlanPrice = {
  amount?: number | null
  interval?: string | null
  billingUnits?: number | null
  billing_units?: number | null
  billingMethod?: string | null
  billing_method?: string | null
  display?: AutumnPlanPriceDisplay | null
}

export type AutumnPlanItem = {
  featureId?: string
  feature_id?: string
  included?: number | null
  unlimited?: boolean | null
  price?: AutumnPlanPrice | null
  display?: AutumnPlanPriceDisplay | null
  reset?: { interval?: string | null } | null
}

export type AutumnPlanResponse = {
  id?: string
  name?: string | null
  price?: AutumnPlanPrice | null
  items?: AutumnPlanItem[]
}

type AutumnRequestBody = Record<string, unknown>

function autumnSecretKey() {
  return process.env.AUTUMN_SECRET_KEY ?? null
}

function isAutumnDisabled() {
  return process.env.AUTUMN_DISABLED === "true" || process.env.NODE_ENV === "test"
}

export function isAutumnConfigured() {
  return !isAutumnDisabled() && autumnSecretKey() !== null
}

function shouldFailOpen() {
  return process.env.AUTUMN_FAIL_OPEN !== "false"
}

function baseUrl() {
  return (process.env.AUTUMN_API_BASE ?? DEFAULT_AUTUMN_API_BASE).replace(/\/$/, "")
}

async function autumnRequest<T>(path: string, body: AutumnRequestBody): Promise<T | null> {
  if (isAutumnDisabled()) return null
  const secretKey = autumnSecretKey()
  if (!secretKey) {
    if (process.env.NODE_ENV !== "test") console.warn("[autumn] AUTUMN_SECRET_KEY is not set; allowing access without billing checks")
    return null
  }

  try {
    const response = await fetch(`${baseUrl()}/v1/${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        "x-api-version": AUTUMN_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      const message = `[autumn] ${path} failed with ${response.status}${detail ? `: ${detail}` : ""}`
      if (response.status >= 500 && shouldFailOpen()) {
        console.warn(`${message}; failing open`)
        return null
      }
      throw new Error(message)
    }

    return response.json() as Promise<T>
  } catch (error) {
    if (shouldFailOpen()) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[autumn] ${path} unavailable; failing open: ${message}`)
      return null
    }
    throw error
  }
}

export async function getOrCreateAutumnCustomer(customerId: string) {
  return autumnRequest("customers.get_or_create", {
    customer_id: customerId,
    auto_enable_plan_id: process.env.AUTUMN_FREE_PLAN_ID,
  })
}

export async function getAutumnCustomer(customerId: string) {
  return autumnRequest<AutumnCustomerResponse>("customers.get", {
    customer_id: customerId,
  })
}

export async function getAutumnPlan(planId: string) {
  return autumnRequest<AutumnPlanResponse>("plans.get", {
    plan_id: planId,
  })
}

export async function checkAutumnFeature(customerId: string, featureId: AutumnFeature, options: { sendEvent?: boolean; requiredBalance?: number } = {}) {
  await getOrCreateAutumnCustomer(customerId)
  return autumnRequest<AutumnCheckResponse>("balances.check", {
    customer_id: customerId,
    feature_id: featureId,
    required_balance: options.requiredBalance ?? 1,
    send_event: options.sendEvent ?? false,
  })
}

export async function updateAutumnUsage(customerId: string, featureId: AutumnFeature, usage: number) {
  await getOrCreateAutumnCustomer(customerId)
  // Non-consumable resources are set directly so Autumn mirrors our active DB counts.
  return autumnRequest("balances.update", {
    customer_id: customerId,
    feature_id: featureId,
    usage,
  })
}
