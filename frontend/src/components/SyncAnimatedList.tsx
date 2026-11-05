import { Component, createRef, type HTMLAttributes, type ReactNode, type RefObject } from "react"

const FADE_MS = 140
const SLIDE_MS = 220
const EASING = "cubic-bezier(.2,.8,.2,1)"
export type SyncListItem = { key: string; content: ReactNode; layoutKey?: string }

type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  items: SyncListItem[]
  scopeKey: string
  remoteRevision: number
  disabled: boolean
  axis?: "horizontal" | "vertical"
  containerRef?: RefObject<HTMLDivElement | null>
}

type Position = { top: number; left: number; width: number; height: number; opacity: number }
type Snapshot = {
  positions: Map<string, Position>
  outgoing: Map<string, HTMLElement>
  anchor: string | undefined
}

function sameLayout(left: SyncListItem[], right: SyncListItem[]) {
  return left.length === right.length && left.every((item, index) => item.key === right[index].key && item.layoutKey === right[index].layoutKey)
}

// React's pre-commit snapshot captures positions before rows are removed. Only
// inert visual copies survive the commit; editable rows always use current data.
export class SyncAnimatedList extends Component<Props> {
  private fallbackRef = createRef<HTMLDivElement>()
  private get listRef() { return this.props.containerRef ?? this.fallbackRef }
  private animations = new Set<Animation>()
  private ghosts = new Map<string, HTMLElement>()
  private motionPreference: MediaQueryList | null = null

  componentDidMount() {
    this.motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")
    this.motionPreference.addEventListener("change", this.onMotionPreference)
    document.addEventListener("visibilitychange", this.onVisibility)
  }

  componentWillUnmount() {
    this.stopAnimations()
    this.motionPreference?.removeEventListener("change", this.onMotionPreference)
    document.removeEventListener("visibilitychange", this.onVisibility)
  }

  private onMotionPreference = () => {
    if (this.motionPreference?.matches) this.stopAnimations()
  }

  private onVisibility = () => {
    if (document.hidden) this.stopAnimations()
  }

  private stopAnimations() {
    for (const animation of this.animations) {
      animation.onfinish = null
      animation.cancel()
    }
    this.animations.clear()
    for (const ghost of this.ghosts.values()) ghost.remove()
    this.ghosts.clear()
  }

  private rows() {
    const rows = new Map<string, HTMLElement>()
    for (const child of this.listRef.current?.children ?? []) {
      if (child instanceof HTMLElement && child.dataset.syncMotionKey) rows.set(child.dataset.syncMotionKey, child)
    }
    return rows
  }

  private measure(rows: Map<string, HTMLElement>) {
    const list = this.listRef.current!
    const bounds = list.getBoundingClientRect()
    // The overview lives inside a scaled canvas; transforms use local pixels.
    const scale = list.offsetWidth ? bounds.width / list.offsetWidth : 1
    const positions = new Map<string, Position>()
    for (const [key, row] of rows) {
      const rect = row.getBoundingClientRect()
      positions.set(key, {
        top: (rect.top - bounds.top) / scale,
        left: (rect.left - bounds.left) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
        opacity: Number(getComputedStyle(row).opacity),
      })
    }
    return positions
  }

  getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
    if (this.props.scopeKey !== previous.scopeKey || this.props.remoteRevision === previous.remoteRevision
      || this.props.disabled || this.motionPreference?.matches || document.hidden
      || sameLayout(previous.items, this.props.items) || !this.listRef.current?.offsetWidth
      || typeof this.listRef.current.animate !== "function") return null

    const rows = this.rows()
    const positions = this.measure(new Map([...this.ghosts, ...rows]))
    const nextKeys = new Set(this.props.items.map((item) => item.key))
    const outgoing = new Map<string, HTMLElement>()
    for (const [key, row] of new Map([...this.ghosts, ...rows])) {
      if (!nextKeys.has(key)) outgoing.set(key, row.cloneNode(true) as HTMLElement)
    }
    const anchor = [...rows.keys()].find((key) => {
      const position = positions.get(key)!
      const offset = this.props.axis === "horizontal" ? position.left : position.top
      const size = this.props.axis === "horizontal" ? this.listRef.current!.clientWidth : this.listRef.current!.clientHeight
      return nextKeys.has(key) && offset >= 0 && offset < size
    })
    return { positions, outgoing, anchor }
  }

  componentDidUpdate(previous: Props, _state: unknown, snapshot: Snapshot | null) {
    if (!snapshot) {
      if (this.props.disabled || this.props.scopeKey !== previous.scopeKey || !sameLayout(previous.items, this.props.items)) this.stopAnimations()
      return
    }

    this.stopAnimations()
    const list = this.listRef.current!
    const rows = this.rows()
    let positions = this.measure(rows)
    // Keep the reader's place when a change happens above the scrolled viewport.
    // At either end of the list, the browser clamps to the available scroll range.
    if (snapshot.anchor) {
      const old = snapshot.positions.get(snapshot.anchor)!
      const next = positions.get(snapshot.anchor)!
      if (this.props.axis === "horizontal") {
        if (list.scrollLeft !== 0) list.scrollLeft += next.left - old.left
      } else if (list.scrollTop > 0) {
        list.scrollTop += next.top - old.top
      }
      positions = this.measure(rows)
    }

    const delay = snapshot.outgoing.size ? FADE_MS : 0
    for (const [key, ghost] of snapshot.outgoing) {
      const old = snapshot.positions.get(key)!
      ghost.removeAttribute("data-sync-motion-key")
      ghost.setAttribute("data-sync-motion-ghost", "")
      ghost.setAttribute("aria-hidden", "true")
      ghost.inert = true
      // Drag hit testing must only see live rows, even if sync interrupts a drag.
      for (const node of ghost.querySelectorAll("[data-mobile-thought-id], [id]")) {
        node.removeAttribute("data-mobile-thought-id")
        node.removeAttribute("id")
      }
      Object.assign(ghost.style, {
        position: "absolute", top: `${old.top + list.scrollTop}px`, left: `${old.left + list.scrollLeft}px`,
        width: `${old.width}px`, height: `${old.height}px`, margin: "0", transform: "none",
        pointerEvents: "none", opacity: String(old.opacity),
      })
      list.appendChild(ghost)
      this.ghosts.set(key, ghost)
      this.animate(ghost, [{ opacity: old.opacity }, { opacity: 0 }], { duration: FADE_MS, easing: "ease-out" }, () => {
        ghost.remove()
        this.ghosts.delete(key)
      })
    }

    for (const [key, row] of rows) {
      const old = snapshot.positions.get(key)
      const next = positions.get(key)!
      if (old) {
        const x = old.left - next.left
        const y = old.top - next.top
        if (Math.abs(x) > .1 || Math.abs(y) > .1) {
          this.animate(row, [{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }], { duration: SLIDE_MS, delay })
        }
      }
      if (!old || old.opacity < 1) {
        this.animate(row, [{ opacity: old?.opacity ?? 0 }, { opacity: 1 }], { duration: FADE_MS, delay: old ? 0 : delay + 60, easing: "ease-out" })
      }
    }
  }

  private animate(node: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions, onFinish?: () => void) {
    const animation = node.animate(frames, { easing: EASING, fill: "both", ...timing })
    this.animations.add(animation)
    animation.onfinish = () => {
      onFinish?.()
      animation.cancel()
      this.animations.delete(animation)
    }
  }

  render() {
    const { items, scopeKey, remoteRevision, disabled, axis, containerRef, style, ...attributes } = this.props
    return <div {...attributes} ref={this.listRef} style={{ ...style, position: style?.position ?? "relative", overflowAnchor: "none" }}>
      {items.map((item) => <div key={item.key} data-sync-motion-key={item.key} style={{ flexShrink: 0, display: axis === "horizontal" ? "flex" : undefined }}>
        {item.content}
      </div>)}
    </div>
  }
}
