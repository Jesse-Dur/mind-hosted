import { sql } from "../client"

export function jsonValue(value: unknown) {
  return sql.json(value as never)
}

export function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

export function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback
}

export function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback
}

export function stringArrayValue(value: unknown) {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
    ? value
    : []
}

export function nullablePositiveId(value: unknown) {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined
  return value
}

export function positiveId(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}
