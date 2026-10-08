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
let preparingAccount = false
const tasks = new Set<TrackedTask>()

export function currentSyncAccountScope(): SyncAccountScope | null {
  return activeScope
}

export function isSyncAccountScopeCurrent(scope: SyncAccountScope | null | undefined) {
  if (preparingAccount) return false
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

export async function prepareSyncAccount(userId: string, prepareStorage?: (assertCurrent: () => void) => Promise<void>) {
  if (!prepareStorage && !preparingAccount && activeScope?.userId === userId && !activeScope.signal.aborted) return activeScope
  preparingAccount = true
  abortActiveScope(false)
  const nextGeneration = generation
  const assertCurrent = () => {
    if (generation !== nextGeneration) throw new StaleSyncAccountError()
  }
  await waitForPriorGenerations(nextGeneration)
  assertCurrent()
  await prepareStorage?.(assertCurrent)
  assertCurrent()
  const controller = new AbortController()
  activeScope = { userId, generation: nextGeneration, signal: controller.signal, controller }
  preparingAccount = false
  return activeScope
}

// Close the old account's request window before a caller publishes new auth.
// Storage preparation will reopen work only after its matching handle is ready.
export function suspendSyncAccount() {
  preparingAccount = true
  return abortActiveScope(false)
}

export function invalidateSyncAccount() {
  preparingAccount = false
  return abortActiveScope()
}

export async function quiesceSyncAccount() {
  preparingAccount = true
  abortActiveScope(false)
  const quiesceGeneration = generation
  await waitForPriorGenerations(quiesceGeneration)
  if (generation === quiesceGeneration) activeScope = null
}

export function runSyncAccountTask<T>(work: (scope: SyncAccountScope | null) => Promise<T>): Promise<T> {
  const scope = currentSyncAccountScope()
  if (!isSyncAccountScopeCurrent(scope)) return Promise.reject(new StaleSyncAccountError())
  const taskGeneration = generation
  const promise = Promise.resolve().then(() => {
    if (taskGeneration !== generation) throw new StaleSyncAccountError()
    assertSyncAccountScopeCurrent(scope)
    return work(scope)
  })
  const tracked: TrackedTask = { generation: taskGeneration, promise }
  tasks.add(tracked)
  void promise.finally(() => tasks.delete(tracked)).catch(() => undefined)
  return promise
}
