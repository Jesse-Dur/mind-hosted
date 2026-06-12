type OptimisticEntity = {
  id: number
  stableKey?: string
}

export function isTemporaryId(id: number) {
  return id < 0
}

export function optimisticIdentityKey(entity: OptimisticEntity, prefix: string) {
  // Optimistic entities swap their temporary id for a server id; stable keys
  // keep React from remounting editable UI during that handoff.
  return entity.stableKey ?? `${prefix}-${entity.id}`
}
