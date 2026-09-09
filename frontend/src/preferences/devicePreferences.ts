import type { DeviceClass } from "../api/client"
import { getApi } from "../store/apiAuth"
import { getActiveSyncUserId } from "../sync/localDb"
import { assertSyncAccountScopeCurrent, currentSyncAccountScope, runSyncAccountTask } from "../sync/accountScope"

const DEVICE_ID_KEY = "mind.device-id"
const LEGACY_TABS_KEY = "tabsVisible"
const LEGACY_CANVAS_HEIGHT_KEY = "canvasHeight"
const PROFILE_PREFIX = "mind.device-preferences."

export type DevicePreferences = {
  tabsVisible: boolean
  canvasHeight: number
  mobilePortraitSplit: number
  mobileLandscapeSplit: number
  focusedTileByCanvas: Record<string, string>
}

const DEFAULTS: DevicePreferences = {
  tabsVisible: true,
  canvasHeight: 1440,
  mobilePortraitSplit: 0.36,
  mobileLandscapeSplit: 0.38,
  focusedTileByCanvas: {},
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let remoteEnabled = false
let onlineListenerInstalled = false
let lastPreferences = DEFAULTS
let profileGeneration = 0

type StoredProfile = { preferences: DevicePreferences; pending: boolean; updatedAt: number }

function storageAvailable() {
  return typeof localStorage !== "undefined"
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

export function getDeviceId() {
  if (!storageAvailable()) return "device_server_render"
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = makeId()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

export function getDeviceClass(): DeviceClass {
  if (typeof window === "undefined") return "desktop"
  const width = Math.min(window.innerWidth, window.screen?.width || window.innerWidth)
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false
  if (width <= 700) return "phone"
  if (width <= 1180 && coarse) return "tablet"
  return "desktop"
}

function profileKey() {
  const account = getActiveSyncUserId()
  return `${PROFILE_PREFIX}${account ? `${encodeURIComponent(account)}.` : ""}${getDeviceId()}`
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function canvasHeightPreference(value: unknown) {
  const height = numberInRange(value, DEFAULTS.canvasHeight, 720, 4320)
  return [1080, 1440, 2160].reduce((closest, option) => Math.abs(option - height) < Math.abs(closest - height) ? option : closest, 1440)
}

export function normalizeDevicePreferences(value: unknown): DevicePreferences {
  const raw = value && typeof value === "object" ? value as Partial<DevicePreferences> : {}
  const focused = raw.focusedTileByCanvas && typeof raw.focusedTileByCanvas === "object" && !Array.isArray(raw.focusedTileByCanvas)
    ? Object.fromEntries(Object.entries(raw.focusedTileByCanvas).filter((entry): entry is [string, string] => typeof entry[1] === "string").slice(-100))
    : {}
  return {
    tabsVisible: typeof raw.tabsVisible === "boolean" ? raw.tabsVisible : DEFAULTS.tabsVisible,
    canvasHeight: canvasHeightPreference(raw.canvasHeight),
    mobilePortraitSplit: numberInRange(raw.mobilePortraitSplit, DEFAULTS.mobilePortraitSplit, 0, 0.72),
    mobileLandscapeSplit: numberInRange(raw.mobileLandscapeSplit, DEFAULTS.mobileLandscapeSplit, 0, 0.72),
    focusedTileByCanvas: focused,
  }
}

function parseStoredProfile(value: string | null): StoredProfile | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { preferences?: unknown; pending?: unknown; updatedAt?: unknown }
    if (parsed && typeof parsed === "object" && "preferences" in parsed) {
      return {
        preferences: normalizeDevicePreferences(parsed.preferences),
        pending: parsed.pending === true,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      }
    }
    return { preferences: normalizeDevicePreferences(parsed), pending: false, updatedAt: 0 }
  } catch {
    return null
  }
}

function readLocalProfile(): StoredProfile {
  if (!storageAvailable()) return { preferences: DEFAULTS, pending: false, updatedAt: 0 }
  const stored = parseStoredProfile(localStorage.getItem(profileKey()))
  if (stored) return stored

  const prePartitionProfile = parseStoredProfile(localStorage.getItem(`${PROFILE_PREFIX}${getDeviceId()}`))
  if (prePartitionProfile) return prePartitionProfile

  return {
    preferences: normalizeDevicePreferences({
      tabsVisible: localStorage.getItem(LEGACY_TABS_KEY) !== "false",
      canvasHeight: Number(localStorage.getItem(LEGACY_CANVAS_HEIGHT_KEY) ?? DEFAULTS.canvasHeight),
    }),
    pending: false,
    updatedAt: 0,
  }
}

export function readLocalDevicePreferences(): DevicePreferences {
  const preferences = readLocalProfile().preferences
  lastPreferences = preferences
  return preferences
}

function writeLocal(preferences: DevicePreferences, pending: boolean) {
  if (!storageAvailable()) return
  lastPreferences = preferences
  localStorage.setItem(profileKey(), JSON.stringify({ preferences, pending, updatedAt: Date.now() }))
}

async function push(preferences: DevicePreferences) {
  if (!remoteEnabled || typeof navigator !== "undefined" && !navigator.onLine) return false
  return runSyncAccountTask(async (scope) => {
    await getApi(scope).preferences.saveDevice(getDeviceId(), getDeviceClass(), preferences)
    assertSyncAccountScopeCurrent(scope)
    if (JSON.stringify(lastPreferences) === JSON.stringify(preferences)) writeLocal(preferences, false)
    return true
  })
}

function installOnlineFlush() {
  if (onlineListenerInstalled || typeof window === "undefined") return
  onlineListenerInstalled = true
  window.addEventListener("online", () => { void push(lastPreferences).catch(console.error) })
}

export function saveDevicePreferences(preferences: DevicePreferences) {
  const normalized = normalizeDevicePreferences(preferences)
  writeLocal(normalized, true)
  if (!remoteEnabled) return
  if (saveTimer) clearTimeout(saveTimer)
  const generation = profileGeneration
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (generation !== profileGeneration) return
    void push(normalized).catch(console.error)
  }, 500)
}

export async function hydrateDevicePreferences(apply: (preferences: DevicePreferences) => void, canUseServer: boolean) {
  const scope = currentSyncAccountScope()
  const generation = ++profileGeneration
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const localProfile = readLocalProfile()
  const local = localProfile.preferences
  lastPreferences = local
  apply(local)
  remoteEnabled = canUseServer
  installOnlineFlush()
  if (!canUseServer || typeof navigator !== "undefined" && !navigator.onLine) return local

  const result = await runSyncAccountTask(async () => getApi(scope).preferences.device(getDeviceId(), getDeviceClass()))
  assertSyncAccountScopeCurrent(scope)
  if (generation !== profileGeneration) return lastPreferences
  const remote = normalizeDevicePreferences(result.preferences)
  const selected = localProfile.pending || result.source === "defaults" ? local : remote
  writeLocal(selected, localProfile.pending || result.source !== "device")
  if (getActiveSyncUserId()) localStorage.removeItem(`${PROFILE_PREFIX}${getDeviceId()}`)
  apply(selected)
  // Claim same-class templates and upload offline device-setting changes.
  if (localProfile.pending || result.source !== "device") await push(selected)
  return selected
}

export function flushDevicePreferences(preferences: DevicePreferences) {
  return push(normalizeDevicePreferences(preferences))
}
