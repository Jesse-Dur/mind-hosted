import type { SyncEntityType } from "./types"

let temporaryIdSequence = 0

export function createClientId(entityType: SyncEntityType) {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${entityType}:${uuid}`
}

export function createTemporarySyncId() {
  temporaryIdSequence += 1
  return -(Date.now() * 1000 + temporaryIdSequence)
}

export function entityKey(entityType: SyncEntityType, clientId: string) {
  return `${entityType}:${clientId}`
}

export function serverClientId(entityType: SyncEntityType, serverId: number) {
  return `${entityType}:server:${serverId}`
}

export function createOperationId(entityType: SyncEntityType, clientId: string, action: string) {
  return `${entityType}:${action}:${clientId}:${Date.now()}:${Math.random().toString(36).slice(2)}`
}
