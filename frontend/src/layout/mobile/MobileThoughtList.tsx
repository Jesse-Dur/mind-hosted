import { Component, createRef, type CSSProperties, type ReactNode } from "react"
import type { Thought } from "../../types"
import { optimisticIdentityKey } from "../../utils/optimisticIdentity"

const FADE_MS = 140
const SLIDE_MS = 220
const EASING = "cubic-bezier(.2,.8,.2,1)"
const keyFor = (thought: Thought) => optimisticIdentityKey(thought, "thought")

type Props = {
  thoughts: Thought[]
  scopeKey: string
  remoteRevision: number
  disabled: boolean
  preview?: boolean
  style: CSSProperties
  renderThought: (thought: Thought) => ReactNode
  footer?: ReactNode
}

type Position = { top: number; left: number; width: number; height: number; opacity: number }
type Snapshot = {
  positions: Map<string, Position>
  outgoing: Map<string, HTMLElement>
  anchor: string | undefined
}

function sameOrder(left: Thought[], right: Thought[]) {
  return left.length === right.length && left.every((thought, index) => keyFor(thought) === keyFor(right[index]))
}

// React's pre-commit snapshot captures positions before rows are removed. Only
// inert visual copies survive the commit; editable rows always use current data.
export class MobileThoughtList extends Component<Props> {
  private listRef = createRef<HTMLDivElement>()
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
      if (child instanceof HTMLElement && child.dataset.thoughtMotionKey) rows.set(child.dataset.thoughtMotionKey, child)
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
      || sameOrder(previous.thoughts, this.props.thoughts) || !this.listRef.current?.offsetWidth
      || typeof this.listRef.current.animate !== "function") return null

    const rows = this.rows()
    const positions = this.measure(new Map([...this.ghosts, ...rows]))
    const nextKeys = new Set(this.props.thoughts.map(keyFor))
    if (this.props.footer) nextKeys.add("footer")
    const outgoing = new Map<string, HTMLElement>()
    for (const [key, row] of new Map([...this.ghosts, ...rows])) {
      if (!nextKeys.has(key)) outgoing.set(key, row.cloneNode(true) as HTMLElement)
    }
    const anchor = [...rows.keys()].find((key) => {
      const position = positions.get(key)!
      return nextKeys.has(key) && position.top >= 0 && position.top < this.listRef.current!.clientHeight
    })
    return { positions, outgoing, anchor }
  }

  componentDidUpdate(previous: Props, _state: unknown, snapshot: Snapshot | null) {
    if (!snapshot) {
      if (this.props.disabled || this.props.scopeKey !== previous.scopeKey || !sameOrder(previous.thoughts, this.props.thoughts)) this.stopAnimations()
      return
    }

    this.stopAnimations()
    const list = this.listRef.current!
    const rows = this.rows()
    let positions = this.measure(rows)
    // Keep the reader's place when a change happens above the scrolled viewport.
    // At either end of the list, the browser clamps to the available scroll range.
    if (snapshot.anchor && list.scrollTop > 0) {
      list.scrollTop += positions.get(snapshot.anchor)!.top - snapshot.positions.get(snapshot.anchor)!.top
      positions = this.measure(rows)
    }

    const delay = snapshot.outgoing.size ? FADE_MS : 0
    for (const [key, ghost] of snapshot.outgoing) {
      const old = snapshot.positions.get(key)!
      ghost.removeAttribute("data-thought-motion-key")
      ghost.setAttribute("data-thought-motion-ghost", "")
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
    return <div ref={this.listRef} data-mobile-thought-list={this.props.preview ? undefined : true} style={{ ...this.props.style, position: "relative", overflowAnchor: "none" }}>
      {this.props.thoughts.map((thought) => <div key={keyFor(thought)} data-thought-motion-key={keyFor(thought)} style={{ flexShrink: 0 }}>
        {this.props.renderThought(thought)}
      </div>)}
      {this.props.footer && <div key="footer" data-thought-motion-key="footer" style={{ flexShrink: 0 }}>{this.props.footer}</div>}
    </div>
  }
}

export function ThoughtPreviewBar({ thought }: { thought: Thought }) {
  // A bar keeps its width as it changes position, making reorders readable.
  let hash = 0
  for (const char of keyFor(thought)) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return <div style={{ height: 15, width: `${78 - Math.abs(hash % 3) * 9}%`, borderRadius: 5, background: "linear-gradient(90deg,#e8e8e8,#f2f2f2,#e8e8e8)" }} />
}
