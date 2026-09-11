type OptimisticEntity = {
  id: number
  stableKey?: string
  client_id?: string | null
}

export function isTemporaryId(id: number) {
  return id < 0
}

export function optimisticIdentityKey(entity: OptimisticEntity, prefix: string) {
  // Optimistic entities swap their temporary id for a server id; stable keys
  // keep React from remounting editable UI during that handoff.
  return entity.stableKey ?? (entity.client_id ? `${prefix}-${entity.client_id}` : `${prefix}-${entity.id}`)
}
