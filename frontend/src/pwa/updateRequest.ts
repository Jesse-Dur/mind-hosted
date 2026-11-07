export class UpdateError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ?? code)
    this.name = "UpdateError"
  }
}

export function updateErrorMessage(error: unknown) {
  switch (error instanceof UpdateError ? error.code : null) {
    case "timeout": return "The update took too long. Try again."
    case "offline": return "You appear to be offline. Reconnect and try again."
    case "download-failed": return "Couldn’t download the update. Try again."
    case "storage-full": return "Not enough storage for the update. Free up some space and try again."
    case "storage-unavailable": return "Couldn’t save the update on this device. Close and reopen Mind, then try again."
    case "activation-failed": return "Couldn’t finish installing the update. Close and reopen Mind, then try again."
    case "prepare-failed": return "Couldn’t prepare the update. Try again."
    case "worker-unavailable": return "This update is no longer available. Close and reopen Mind to check for the latest version."
    default: return "Couldn’t update Mind. Try again."
  }
}

export function messageWorker(worker: ServiceWorker, type: "PREPARE_UPDATE" | "SKIP_WAITING", payload: { workspace: string; urls: string[] }) {
  if (worker.state === "redundant") return Promise.reject(new UpdateError("worker-unavailable"))
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel()
    let finished = false
    const finish = (error?: UpdateError) => {
      if (finished) return
      finished = true
      globalThis.clearTimeout(timeout)
      channel.port1.close()
      if (error) reject(error)
      else resolve()
    }
    const timeout = globalThis.setTimeout(() => finish(new UpdateError("timeout")), 20000)
    channel.port1.onmessage = (event) => {
      const data = event.data
      finish(data?.ok === true ? undefined : new UpdateError(
        typeof data?.code === "string" ? data.code : "update-failed",
        typeof data?.error === "string" ? data.error : undefined,
      ))
    }
    try {
      worker.postMessage({ type, ...payload }, [channel.port2])
    } catch {
      channel.port2.close()
      finish(new UpdateError("worker-unavailable"))
    }
  })
}
