import { IDBKeyRange, indexedDB } from "fake-indexeddb"
import type { Canvas, Tag, Thought, Tile } from "../types"
import type { LocalEntityRecord, OutboxRecord } from "../sync/types"

type TestWindow = {
  setTimeout: (handler: () => void, timeout?: number) => number
  clearTimeout: (handle: number) => void
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
}

type TestNavigator = {
  locks?: {
    request: <T>(name: string, callback: () => T | Promise<T>) => Promise<T>
  }
}

type TestDocument = {
  visibilityState: DocumentVisibilityState
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
}

type TestLocalStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createLocalStorage(): TestLocalStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
  }
}

const globals = globalThis as unknown as {
  indexedDB: typeof indexedDB
  IDBKeyRange: typeof IDBKeyRange
  window: TestWindow
  navigator: TestNavigator
  document: TestDocument
  localStorage: TestLocalStorage
  fetch: (path: string, init?: RequestInit) => Promise<Response>
}

globals.indexedDB = indexedDB
globals.IDBKeyRange = IDBKeyRange
globals.window = {
  setTimeout: () => 1,
  clearTimeout: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}
globals.navigator = {}
globals.document = {
  visibilityState: "visible",
  addEventListener: () => {},
  removeEventListener: () => {},
}
globals.localStorage = createLocalStorage()
globals.fetch = async (path) => {
  const body = String(path).includes("/sync/pull")
    ? { events: [], latest_revision: 0 }
    : String(path).includes("/sync/snapshot")
      ? { revision: 0, active_canvas_id: null, canvases: [], tags: [], tiles: [], thoughts: [] }
      : { results: [] }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

export const { syncDb } = await import("../sync/localDb")
export const { setGetToken, useStore } = await import("../store")
export const { clearReauthRequired } = await import("../auth/reauthSignal")
export const { entityKey } = await import("../sync/ids")

export const NOW = "2026-01-01T00:00:00.000Z"

export function canvas(overrides: Partial<Canvas> = {}): Canvas {
  return {
    id: 10,
    client_id: "canvas-client",
    name: "Home",
    sort_order: 0,
    is_favourite: false,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function tile(overrides: Partial<Tile> = {}): Tile {
  return {
    id: 20,
    client_id: "tile-client",
    canvas_id: 10,
    title: "Tasks",
    x: 0,
    y: 0,
    width: 280,
    height: 200,
    importance: 1,
    visible: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function thought(overrides: Partial<Thought> = {}): Thought {
  return {
    id: 30,
    client_id: "thought-client",
    tile_id: 20,
    content: "Follow up",
    tags: [],
    sort_order: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

export function tag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 40,
    client_id: "tag-client",
    name: "work",
    color: "#123456",
    updated_at: NOW,
    ...overrides,
  }
}

export function entityRecord(record: Omit<LocalEntityRecord, "key" | "updatedAt">): LocalEntityRecord {
  return {
    ...record,
    key: entityKey(record.entityType, record.clientId),
    updatedAt: Date.now(),
  }
}

export function outboxRecord(record: Omit<OutboxRecord, "status" | "attemptCount" | "nextAttemptAt" | "createdAt" | "updatedAt">): OutboxRecord {
  const now = Date.now()
  return {
    ...record,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export async function resetFrontendState() {
  await Promise.all([
    syncDb.entities.clear(),
    syncDb.outbox.clear(),
    syncDb.metadata.clear(),
  ])
  globals.localStorage.clear()
  clearReauthRequired()
  setGetToken(() => Promise.resolve("test-token"))
  useStore.setState({
    canvases: [],
    activeCanvasId: null,
    tags: [],
    tiles: [],
    thoughts: [],
    tileCache: new Map(),
    thoughtCache: new Map(),
    thoughtStableKeys: new Map(),
    remoteChangedTileIds: new Set(),
    remoteChangedThoughtIds: new Set(),
    syncPendingCount: 0,
  })
}
