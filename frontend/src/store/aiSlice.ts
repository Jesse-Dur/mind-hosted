import type { AiSlice, StoreSlice } from "./types"
import { getApi } from "./apiAuth"

export const createAiSlice: StoreSlice<AiSlice> = (set, get) => ({
  aiStatus: "idle",

  loadAiStatus: async () => {
    try {
      const { status } = await getApi().ai.status()
      set({ aiStatus: status as AiSlice["aiStatus"] })
    } catch { /* ignore transient status failures */ }
  },

  startAiPolling: () => {
    let poll: ReturnType<typeof setInterval> | null = null
    let lastRevision: number | null = null
    let syncing = false
    const safety = setTimeout(() => {
      if (poll !== null) clearInterval(poll)
    }, 120000)

    const syncIfRevisionChanged = async (latestRevision: number) => {
      if (syncing) return
      if (lastRevision !== null && latestRevision <= lastRevision) return
      lastRevision = latestRevision
      syncing = true
      try {
        await get().syncNow()
      } finally {
        syncing = false
      }
    }

    poll = setInterval(async () => {
      try {
        const { status, latest_revision } = await getApi().ai.status()
        set({ aiStatus: status as AiSlice["aiStatus"] })
        await syncIfRevisionChanged(latest_revision)
        if (status === "idle") {
          if (poll !== null) clearInterval(poll)
          clearTimeout(safety)
          await get().syncNow()
        }
      } catch {
        if (poll !== null) clearInterval(poll)
        clearTimeout(safety)
      }
    }, 1000)
  },

  setAiStatus: (status) => set({ aiStatus: status }),

  processAiInput: (input, priority = "medium") => {
    const trimmed = input.trim()
    if (!trimmed) return
    set({ aiStatus: "processing" })
    get().startAiPolling()
    getApi().ai.process(trimmed, priority).catch(console.error)
  },
})
