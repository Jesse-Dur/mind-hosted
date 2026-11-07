import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { IDBKeyRange, indexedDB } from "fake-indexeddb"
import { act, StrictMode } from "react"
import type { Root } from "react-dom/client"

const browser = new Window({ url: "http://localhost" })
for (const name of ["window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "MutationObserver", "ResizeObserver"] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? browser : browser[name] })
}
Object.assign(globalThis, {
  indexedDB, IDBKeyRange,
  IS_REACT_ACT_ENVIRONMENT: true,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
})
mock.module("@clerk/clerk-react", () => ({ useAuth: () => ({ getToken: async () => "test-token" }) }))
const { createRoot } = await import("react-dom/client")
const { useMicRecording } = await import("./useMicRecording")
const { Spotlight } = await import("../components/Spotlight")
const { syncDb } = await import("../sync/localDb")

type Track = { readyState: string; stop: ReturnType<typeof mock> }
function stream() {
  const tracks: Track[] = Array.from({ length: 2 }, () => {
    const track: Track = { readyState: "live", stop: mock(() => { track.readyState = "ended" }) }
    return track
  })
  return { tracks, getTracks: () => tracks }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class Recorder {
  static instances: Recorder[] = []
  static failure: "constructor" | "start" | "stop" | null = null
  state = "inactive"
  mimeType = "audio/mp4"
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  constructor() {
    if (Recorder.failure === "constructor") throw new Error("recorder constructor failed")
    Recorder.instances.push(this)
  }
  start() {
    if (Recorder.failure === "start") throw new Error("recorder start failed")
    this.state = "recording"
  }
  stop = mock(() => {
    if (Recorder.failure === "stop") throw new Error("recorder stop failed")
    this.state = "inactive"
    // Browser events are queued, so tests explicitly deliver them after cleanup.
  })
  data() { this.ondataavailable?.({ data: new Blob(["a".repeat(1500)], { type: this.mimeType }) }) }
  finish() { this.data(); this.onstop?.() }
}

class Context {
  static instances: Context[] = []
  static failure: "constructor" | "analyser" | "source" | null = null
  static silent = false
  state = "running"
  close = mock(async () => { this.state = "closed" })
  constructor() {
    if (Context.failure === "constructor") throw new Error("audio context failed")
    Context.instances.push(this)
  }
  createAnalyser() {
    if (Context.failure === "analyser") throw new Error("analyser failed")
    return { fftSize: 256, frequencyBinCount: 128, getByteFrequencyData: (data: Uint8Array) => data.fill(Context.silent ? 0 : 100) }
  }
  createMediaStreamSource() {
    if (Context.failure === "source") throw new Error("source failed")
    return { connect() {} }
  }
}

let root: Root | null = null
let host: HTMLDivElement
let mic: ReturnType<typeof useMicRecording>
let acquired: ReturnType<typeof stream>[]
let requests: ReturnType<typeof mock>
let transcribe: ReturnType<typeof mock>
let transcript: ReturnType<typeof mock>
const intervals = new Set<() => void>()
const originalInterval = globalThis.setInterval
const originalClearInterval = globalThis.clearInterval
const originalFetch = globalThis.fetch

beforeEach(() => {
  Recorder.instances = []
  Recorder.failure = null
  Context.instances = []
  Context.failure = null
  Context.silent = false
  acquired = []
  requests = mock(async () => {
    const next = stream()
    acquired.push(next)
    return next
  })
  Object.defineProperty(browser.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: requests } })
  Object.assign(globalThis, { MediaRecorder: Recorder, AudioContext: Context })
  // Control silence without waiting three seconds in each test.
  globalThis.setInterval = ((callback: () => void) => { intervals.add(callback); return callback }) as unknown as typeof setInterval
  globalThis.clearInterval = ((callback: () => void) => { intervals.delete(callback) }) as unknown as typeof clearInterval
  transcribe = mock(async () => Response.json({ text: "recorded words" }))
  globalThis.fetch = transcribe as typeof fetch
  transcript = mock(() => {})
  host = document.createElement("div")
  document.body.append(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host.remove()
  for (const audio of acquired) expect(audio.tracks.every((track) => track.readyState === "ended")).toBe(true)
  for (const context of Context.instances) expect(context.close).toHaveBeenCalledTimes(1)
  expect(intervals.size).toBe(0)
  intervals.clear()
  globalThis.setInterval = originalInterval
  globalThis.clearInterval = originalClearInterval
  globalThis.fetch = originalFetch
  await syncDb.delete()
})

function Harness() {
  mic = useMicRecording(async () => "test-token", transcript)
  return null
}
async function mount() {
  root = createRoot(host)
  await act(async () => root!.render(<Harness />))
}
async function start(withChunk = true) {
  await act(async () => mic.handleMic())
  const recorder = Recorder.instances.at(-1)!
  if (withChunk) await act(async () => recorder.data())
  return recorder
}
function expectReleased(index = 0) {
  expect(acquired[index]!.tracks.every((track) => track.readyState === "ended")).toBe(true)
  expect(Context.instances[index]?.state ?? "closed").toBe("closed")
  expect(intervals.size).toBe(0)
}

const stopModes = ["button", "typing", "shortcut", "silence"] as const
for (const mode of stopModes) {
  test(`${mode} releases hardware before final recorder events and preserves audio`, async () => {
    await mount()
    const recorder = await start()
    // The normal path requires one second of audio.
    const now = Date.now()
    const clock = mock(() => now + 1500)
    const originalNow = Date.now
    Date.now = clock
    const sent = mock(() => {})
    try {
      await act(async () => {
        if (mode === "button") mic.handleMic()
        if (mode === "typing") mic.stopForEditing()
        if (mode === "shortcut") mic.stopAndTranscribe(sent)
        if (mode === "silence") {
          Context.silent = true
          for (let tick = 0; tick < 30; tick++) for (const callback of intervals) callback()
        }
      })
      expectReleased()
      expect(transcribe).not.toHaveBeenCalled()
      expect(mic.micState).toBe("transcribing")
      await act(async () => recorder.finish())
      expect(mic.micState).toBe("idle")
      if (mode === "silence") {
        expect(transcribe).not.toHaveBeenCalled()
        expect(mic.micError).toBe("No sound detected")
      } else {
        expect(transcribe).toHaveBeenCalledTimes(1)
        const body = (transcribe.mock.calls[0]![1] as RequestInit).body as FormData
        const audio = body.get("audio") as File
        expect(audio.type).toBe("audio/mp4")
        expect(audio.size).toBe(3000)
        expect(mode === "shortcut" ? sent : transcript).toHaveBeenCalledWith("recorded words")
      }
    } finally { Date.now = originalNow }
  })
}

test.each([false, true])("cancel releases loading/recording hardware without transcription (chunk: %s)", async (withChunk) => {
  await mount()
  const recorder = await start(withChunk)
  await act(async () => mic.cancelRecording())
  expectReleased()
  await act(async () => recorder.finish())
  expect(mic.micState).toBe("idle")
  expect(mic.micError).toBeNull()
  expect(transcribe).not.toHaveBeenCalled()
})

test.each(["cancel", "typing", "unmount", "pagehide"])("%s discards a late microphone permission result", async (mode) => {
  const permission = deferred<ReturnType<typeof stream>>()
  requests.mockImplementation(() => permission.promise)
  await mount()
  await act(async () => mic.handleMic())
  expect(mic.micState).toBe("loading")
  await act(async () => {
    if (mode === "cancel") mic.cancelRecording()
    if (mode === "typing") mic.stopForEditing()
    if (mode === "unmount") { root!.unmount(); root = null }
    if (mode === "pagehide") window.dispatchEvent(new Event("pagehide"))
  })
  const late = stream()
  acquired.push(late)
  await act(async () => permission.resolve(late))
  expect(late.tracks.every((track) => track.readyState === "ended")).toBe(true)
  expect(Recorder.instances).toHaveLength(0)
  expect(Context.instances).toHaveLength(0)
})

test.each(["unmount", "pagehide"])("%s releases an active recording", async (mode) => {
  await mount()
  const recorder = await start()
  await act(async () => {
    if (mode === "unmount") { root!.unmount(); root = null }
    else window.dispatchEvent(new Event("pagehide"))
  })
  expectReleased()
  await act(async () => recorder.finish())
  expect(transcribe).not.toHaveBeenCalled()
})

test.each(["context", "analyser", "source", "recorder", "start", "stop", "error"])("%s failure releases all acquired resources", async (stage) => {
  await mount()
  if (stage === "context") Context.failure = "constructor"
  if (stage === "analyser" || stage === "source") Context.failure = stage
  if (stage === "recorder") Recorder.failure = "constructor"
  if (stage === "start") Recorder.failure = "start"
  const recorder = await start(false)
  if (stage === "stop") {
    Recorder.failure = "stop"
    await act(async () => mic.stopForEditing())
  }
  if (stage === "error") await act(async () => recorder.onerror?.(new Error("device lost")))
  expectReleased()
  expect(mic.micState).toBe("idle")
  expect(mic.micError).toBe("Microphone unavailable")
  expect(transcribe).not.toHaveBeenCalled()
})

test("late events from a cancelled recording cannot stop a new one", async () => {
  await mount()
  const first = await start()
  await act(async () => mic.cancelRecording())
  const second = await start()
  await act(async () => first.finish())
  expect(acquired[1]!.tracks.every((track) => track.readyState === "live")).toBe(true)
  expect(mic.micState).toBe("recording")
  expect(second.state).toBe("recording")
  expect(transcribe).not.toHaveBeenCalled()
})

test("a late permission result cannot replace the current recording", async () => {
  const permission = deferred<ReturnType<typeof stream>>()
  requests.mockImplementationOnce(() => permission.promise)
  await mount()
  await act(async () => mic.handleMic())
  await act(async () => mic.cancelRecording())
  await start()
  const late = stream()
  acquired.push(late)
  await act(async () => permission.resolve(late))
  expect(late.tracks.every((track) => track.readyState === "ended")).toBe(true)
  expect(acquired[0]!.tracks.every((track) => track.readyState === "live")).toBe(true)
  expect(mic.micState).toBe("recording")
})

test("repeated typing while stopping does not cancel the queued transcript", async () => {
  await mount()
  const recorder = await start()
  await act(async () => { mic.stopAndTranscribe(transcript); mic.stopForEditing() })
  expectReleased()
  await act(async () => recorder.finish())
  expect(transcript).toHaveBeenCalledWith("recorded words")
  expect(recorder.stop).toHaveBeenCalledTimes(1)
})

test("closing during transcription ignores a late result", async () => {
  const response = deferred<Response>()
  transcribe.mockImplementation(() => response.promise)
  await mount()
  const recorder = await start()
  await act(async () => mic.stopAndTranscribe(transcript))
  await act(async () => recorder.finish())
  expectReleased()
  await act(async () => { root!.unmount(); root = null })
  await act(async () => response.resolve(Response.json({ text: "late words" })))
  expect(transcript).not.toHaveBeenCalled()
})

describe("Spotlight microphone events", () => {
  async function open(openedByMic = false) {
    const close = mock(() => {})
    root = createRoot(host)
    await act(async () => root!.render(<StrictMode><Spotlight openedByMic={openedByMic} onClose={close} /></StrictMode>))
    return close
  }
  test("click then Escape cancels without closing Spotlight or retaining the microphone", async () => {
    const close = await open()
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Voice input"]')!.click())
    const recorder = Recorder.instances.at(-1)!
    await act(async () => recorder.data())
    await act(async () => host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expectReleased()
    expect(close).not.toHaveBeenCalled()
    await act(async () => recorder.finish())
    expect(transcribe).not.toHaveBeenCalled()
  })
  test("shortcut auto-start survives Strict Mode effect cleanup", async () => {
    await open(true)
    const active = acquired.filter((audio) => audio.tracks.some((track) => track.readyState === "live"))
    expect(active).toHaveLength(1)
    expect(Recorder.instances.at(-1)!.state).toBe("recording")
  })
})
