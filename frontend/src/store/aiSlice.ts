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
    const safety = setTimeout(() => {
      if (poll !== null) clearInterval(poll)
    }, 120000)

    poll = setInterval(async () => {
      try {
        const { status } = await getApi().ai.status()
        set({ aiStatus: status as AiSlice["aiStatus"] })
        if (status === "idle") {
          if (poll !== null) clearInterval(poll)
          clearTimeout(safety)
          // AI can edit any canvas, so refresh the active view and re-warm caches.
          const { loadThoughts, hydrateRemainingCanvases } = get()
          setTimeout(() => loadThoughts(), 500)
          setTimeout(() => loadThoughts(), 1500)
          setTimeout(() => loadThoughts(), 2500)
          hydrateRemainingCanvases(true).catch(console.error)
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
