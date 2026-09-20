import { useState, useSyncExternalStore } from "react"

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let promptEvent: InstallPromptEvent | null = null
let initialized = false
const listeners = new Set<() => void>()

function emit() { for (const listener of listeners) listener() }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }

export function initializeInstallPrompt() {
  if (initialized || typeof window === "undefined") return
  initialized = true
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    promptEvent = event as InstallPromptEvent
    emit()
  })
  window.addEventListener("appinstalled", () => { promptEvent = null; emit() })
}

function isStandalone() {
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
}

export type ManualInstallKind = "ios" | "mac-safari" | "chromium"

export function getManualInstallKind(userAgent: string, platform: string, maxTouchPoints: number): ManualInstallKind | null {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)
  if (ios) return "ios"

  const safari = /Safari\//.test(userAgent) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)\//.test(userAgent)
  const safariVersion = Number(userAgent.match(/Version\/(\d+)/)?.[1] ?? 0)
  if (safari && /Mac/.test(platform) && safariVersion >= 17) return "mac-safari"

  return /(Chrome|Chromium|CriOS)\//.test(userAgent) ? "chromium" : null
}

export function InstallAppSection() {
  const available = useSyncExternalStore(subscribe, () => Boolean(promptEvent), () => false)
  const standalone = isStandalone()
  const detectedManualKind = getManualInstallKind(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
  const manualKind = window.isSecureContext ? detectedManualKind : null
  const [instructionsOpen, setInstructionsOpen] = useState(false)

  async function install() {
    const event = promptEvent
    if (!event) return
    await event.prompt()
    await event.userChoice
    promptEvent = null
    emit()
  }

  if (standalone || (!available && manualKind === null)) return null

  const buttonLabel = available
    ? "Install Mind on this device"
    : manualKind === "ios"
      ? "Add Mind to Home Screen"
      : manualKind === "mac-safari"
        ? "Add Mind to Dock"
        : "Install Mind"

  return (
    <section style={{ borderTop: "1px solid #eee", paddingTop: 18 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>App</p>
      <button type="button" onClick={() => available ? void install() : setInstructionsOpen(true)} style={{ width: "100%", border: 0, borderRadius: 8, background: "#1a1a1a", color: "#fff", padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{buttonLabel}</button>
      {instructionsOpen && (
        <div role="status" style={{ marginTop: 9, borderRadius: 8, background: "#f7f7f7", padding: "10px 11px", color: "#555", fontSize: 12, lineHeight: 1.5 }}>
          {manualKind === "ios"
            ? <>Open your browser’s Share menu, then tap <strong>Add to Home Screen</strong>.</>
            : manualKind === "mac-safari"
              ? <>In Safari, choose <strong>File → Add to Dock</strong>.</>
              : <>Open your browser’s menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. Brave may place this under <strong>Save and share</strong>.</>}
        </div>
      )}
    </section>
  )
}
