import type { HistoryEvent, HistoryPage } from "../types"
import { getApi } from "./apiAuth"
import type { HistorySlice, StoreSlice } from "./types"
import { readHistoryCache, writeHistoryCache } from "../sync/queryCache"

const HISTORY_PAGE_SIZE = 50
const HISTORY_NEW_ITEM_ANIMATION_MS = 1200

function historyTime(event: HistoryEvent) {
  return new Date(event.created_at).getTime()
}

function sortHistoryEvents(a: HistoryEvent, b: HistoryEvent) {
  return historyTime(b) - historyTime(a) || b.id - a.id
}

function mergeHistoryEvents(current: HistoryEvent[], incoming: HistoryEvent[]) {
  const byId = new Map<number, HistoryEvent>()
  for (const event of current) byId.set(event.id, event)
  for (const event of incoming) byId.set(event.id, event)
  return Array.from(byId.values()).sort(sortHistoryEvents)
}

function mergePage(page: HistoryPage, state: HistorySlice) {
  const knownIds = new Set(state.historyEvents.map((event) => event.id))
  const shouldAnimate = state.historyLoaded
  const insertedIds = shouldAnimate
    ? new Set(page.events.filter((event) => !knownIds.has(event.id)).map((event) => event.id))
    : new Set<number>()

  return {
    historyEvents: mergeHistoryEvents(state.historyEvents, page.events),
    // Refreshes should always re-anchor pagination to the newest first page so
    // later load-more calls do not skip rows inserted above the old cursor.
    historyNextCursor: page.nextCursor,
    historyHasMore: page.hasMore,
    historyLoaded: true,
    newHistoryIds: insertedIds.size > 0 ? new Set([...state.newHistoryIds, ...insertedIds]) : state.newHistoryIds,
    insertedIds,
  }
}

function persistHistoryCache(state: HistorySlice) {
  void writeHistoryCache({
    historyEvents: state.historyEvents,
    historyNextCursor: state.historyNextCursor,
    historyHasMore: state.historyHasMore,
  }).catch(console.error)
}

export const createHistorySlice: StoreSlice<HistorySlice> = (set, get) => ({
  historyEvents: [],
  historyNextCursor: null,
  historyHasMore: false,
  historyLoaded: false,
  historyRefreshing: false,
  historyLoadingMore: false,
  newHistoryIds: new Set<number>(),

  hydrateHistoryCache: async () => {
    const cached = await readHistoryCache()
    if (!cached) return
    const state = get()
    if (state.historyLoaded && state.historyEvents.length > 0) return
    set({
      historyEvents: cached.historyEvents,
      historyNextCursor: cached.historyNextCursor,
      historyHasMore: cached.historyHasMore,
      historyLoaded: true,
      newHistoryIds: new Set(),
    })
  },

  refreshHistory: async () => {
    if (get().historyRefreshing) return
    set({ historyRefreshing: true })

    let insertedIds = new Set<number>()
    try {
      const page = await getApi().history.list(null, HISTORY_PAGE_SIZE)
      set((state) => {
        const merged = mergePage(page, state)
        insertedIds = merged.insertedIds
        const nextState: HistorySlice = {
          ...state,
          historyEvents: merged.historyEvents,
          historyNextCursor: merged.historyNextCursor,
          historyHasMore: merged.historyHasMore,
          historyLoaded: merged.historyLoaded,
          historyRefreshing: state.historyRefreshing,
          historyLoadingMore: state.historyLoadingMore,
          newHistoryIds: merged.newHistoryIds,
        }
        persistHistoryCache(nextState)
        return {
          historyEvents: merged.historyEvents,
          historyNextCursor: merged.historyNextCursor,
          historyHasMore: merged.historyHasMore,
          historyLoaded: merged.historyLoaded,
          newHistoryIds: merged.newHistoryIds,
        }
      })
    } catch (error) {
      console.error(error)
    } finally {
      set({ historyRefreshing: false })
    }

    if (insertedIds.size > 0) {
      setTimeout(() => {
        set((state) => {
          const next = new Set(state.newHistoryIds)
          for (const id of insertedIds) next.delete(id)
          return { newHistoryIds: next }
        })
      }, HISTORY_NEW_ITEM_ANIMATION_MS)
    }
  },

  loadMoreHistory: async () => {
    const state = get()
    if (state.historyLoadingMore || !state.historyHasMore || !state.historyNextCursor) return

    set({ historyLoadingMore: true })
    try {
      const page = await getApi().history.list(state.historyNextCursor, HISTORY_PAGE_SIZE)
      set((current) => {
        const merged = mergePage(page, current)
        const nextState: HistorySlice = {
          ...current,
          historyEvents: merged.historyEvents,
          historyNextCursor: merged.historyNextCursor,
          historyHasMore: merged.historyHasMore,
          historyLoaded: merged.historyLoaded,
          historyRefreshing: current.historyRefreshing,
          historyLoadingMore: current.historyLoadingMore,
          newHistoryIds: merged.newHistoryIds,
        }
        persistHistoryCache(nextState)
        return {
          historyEvents: merged.historyEvents,
          historyNextCursor: merged.historyNextCursor,
          historyHasMore: merged.historyHasMore,
          historyLoaded: merged.historyLoaded,
          newHistoryIds: merged.newHistoryIds,
        }
      })
    } catch (error) {
      console.error(error)
    } finally {
      set({ historyLoadingMore: false })
    }
  },
})
