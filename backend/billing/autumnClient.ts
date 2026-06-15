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
