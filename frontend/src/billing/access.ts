import type { BillingOverage } from "../types"

let currentOverage: BillingOverage | null = null

export class BillingAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BillingAccessError"
  }
}

export function setBillingOverage(overage: BillingOverage | null) {
  currentOverage = overage
}

export function billingOverage() {
  return currentOverage
}

export function assertEditingAllowed() {
  if (currentOverage?.editing_frozen) {
    throw new BillingAccessError("Editing is frozen while this account is above plan limits")
  }
}

export function assertCreationAllowed(feature: BillingOverage["suspended_creation"][number]) {
  assertEditingAllowed()
  if (currentOverage?.suspended_creation.includes(feature)) {
    throw new BillingAccessError(`Creation is suspended for ${feature}`)
  }
}
