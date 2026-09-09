export type SyncAccountScope = {
  userId: string
  generation: number
  signal: AbortSignal
}

type TrackedTask = {
  generation: number
  promise: Promise<unknown>
}

export class StaleSyncAccountError extends Error {
  constructor() {
    super("Sync account changed while work was in progress")
    this.name = "StaleSyncAccountError"
  }
}

let generation = 0
let activeScope: (SyncAccountScope & { controller: AbortController }) | null = null
const tasks = new Set<TrackedTask>()

export function currentSyncAccountScope(): SyncAccountScope | null {
  return activeScope
}

export function isSyncAccountScopeCurrent(scope: SyncAccountScope | null | undefined) {
  if (!scope) return activeScope === null
  return activeScope?.generation === scope.generation && activeScope.userId === scope.userId && !scope.signal.aborted
}

export function assertSyncAccountScopeCurrent(scope: SyncAccountScope | null | undefined) {
  if (!isSyncAccountScopeCurrent(scope)) throw new StaleSyncAccountError()
}

export function isStaleSyncAccountError(error: unknown): error is StaleSyncAccountError {
  return error instanceof StaleSyncAccountError
}

function abortActiveScope(clear = true) {
  const previousGeneration = activeScope?.generation ?? null
  activeScope?.controller.abort()
  if (clear) activeScope = null
  generation += 1
  return previousGeneration
}

async function waitForPriorGenerations(targetGeneration: number) {
  while (true) {
    const pending = [...tasks]
      .filter((task) => task.generation < targetGeneration)
      .map((task) => task.promise)
    if (pending.length === 0) return
    await Promise.allSettled(pending)
  }
}

export async function prepareSyncAccount(userId: string) {
  if (activeScope?.userId === userId && !activeScope.signal.aborted) return activeScope
  abortActiveScope(false)
  const nextGeneration = generation
  await waitForPriorGenerations(nextGeneration)
  if (generation !== nextGeneration) throw new StaleSyncAccountError()
  const controller = new AbortController()
  activeScope = { userId, generation: nextGeneration, signal: controller.signal, controller }
  return activeScope
}

export function invalidateSyncAccount() {
  return abortActiveScope()
}

export async function quiesceSyncAccount() {
  abortActiveScope(false)
  const quiesceGeneration = generation
  await waitForPriorGenerations(quiesceGeneration)
  if (generation === quiesceGeneration) activeScope = null
}

export function runSyncAccountTask<T>(work: (scope: SyncAccountScope | null) => Promise<T>): Promise<T> {
  const scope = currentSyncAccountScope()
  const promise = Promise.resolve().then(() => work(scope))
  if (!scope) return promise
  const tracked: TrackedTask = { generation: scope.generation, promise }
  tasks.add(tracked)
  void promise.finally(() => tasks.delete(tracked)).catch(() => undefined)
  return promise
}
