import type { HistoryEvent, HistoryPage } from "../types"
import { getApi } from "./apiAuth"
import type { HistorySlice, StoreSlice } from "./types"

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
  const shouldReplaceCursor = !state.historyLoaded || (!state.historyHasMore && page.hasMore)

  return {
    historyEvents: mergeHistoryEvents(state.historyEvents, page.events),
    historyNextCursor: shouldReplaceCursor ? page.nextCursor : state.historyNextCursor,
    historyHasMore: shouldReplaceCursor ? page.hasMore : state.historyHasMore,
    historyLoaded: true,
    newHistoryIds: insertedIds.size > 0 ? new Set([...state.newHistoryIds, ...insertedIds]) : state.newHistoryIds,
    insertedIds,
  }
}

export const createHistorySlice: StoreSlice<HistorySlice> = (set, get) => ({
  historyEvents: [],
  historyNextCursor: null,
  historyHasMore: false,
  historyLoaded: false,
  historyRefreshing: false,
  historyLoadingMore: false,
  newHistoryIds: new Set<number>(),

  refreshHistory: async () => {
    if (get().historyRefreshing) return
    set({ historyRefreshing: true })

    let insertedIds = new Set<number>()
    try {
      const page = await getApi().history.list(null, HISTORY_PAGE_SIZE)
      set((state) => {
        const merged = mergePage(page, state)
        insertedIds = merged.insertedIds
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
