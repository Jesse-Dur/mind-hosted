import type { AutumnFeature } from "./features"
import type { AutumnPlanItem, AutumnPlanPriceDisplay } from "./autumnClient"

const USD_PREFIX = "USD "

const USD_CURRENCY = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const PAYG_FEATURES: Partial<Record<AutumnFeature, { label: string; scale: number }>> = {
  ai_processing_requests: { label: "1000 requests", scale: 1000 },
  storage: { label: "GB", scale: 1000 },
  transcription_seconds: { label: "1000 seconds", scale: 1000 },
}

export function displayText(display: AutumnPlanPriceDisplay | null | undefined) {
  const primary = display?.primaryText ?? display?.primary_text ?? null
  const secondary = display?.secondaryText ?? display?.secondary_text ?? null
  return [primary, secondary].filter((part): part is string => typeof part === "string" && part.length > 0).join(" ")
}

export function usdPriceText(amount: number) {
  return `$${USD_CURRENCY.format(amount)}`
}

export function planPriceText(amount: number, interval?: string | null) {
  return `${usdPriceText(amount)}${interval ? ` / ${interval}` : ""}`
}

export function rawPriceText(amount: number, interval?: string | null, units = 1) {
  const intervalSuffix = interval ? ` / ${interval}` : ""
  return `$${amount} per ${units}${intervalSuffix}`
}

export function normalizeMoneyText(text: string) {
  if (text.startsWith(USD_PREFIX)) return text
  if (text.startsWith("$")) return `${USD_PREFIX}${text}`
  return text
}

export function featurePriceText(feature: AutumnFeature, item: AutumnPlanItem) {
  const amount = item.price?.amount
  if (typeof amount !== "number") return null

  const paygFeature = PAYG_FEATURES[feature]
  if (paygFeature) return `${usdPriceText(amount * paygFeature.scale)} per ${paygFeature.label}`

  const units = item.price?.billingUnits ?? item.price?.billing_units ?? 1
  return rawPriceText(amount, item.price?.interval, units)
}
