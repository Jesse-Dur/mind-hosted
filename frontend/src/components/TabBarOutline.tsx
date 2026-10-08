import React, { useEffect, useState } from "react"

// Draws a single continuous SVG path along the bottom of the tab bar.
// Dips down with bezier curves around every [data-tabbar-jut] element automatically.
// Elements with data-tabbar-jut="inactive" use a shallower dip.

const R = 6 // curve radius

interface JutRect { left: number; right: number; depth: number }

function buildPath(width: number, barH: number, juts: JutRect[]): string {
  const sorted = [...juts].sort((a, b) => a.left - b.left)
  const first = sorted[0]
  // If first element touches left edge, start path at bottom-left of that element
  const startsAtLeft = first && first.left <= 1
  let d = startsAtLeft
    ? `M 0 ${first.depth}`
    : `M 0 ${barH}`

  for (let i = 0; i < sorted.length; i++) {
    const { left, right, depth } = sorted[i]
    const touchesRight = right >= width - 1

    if (startsAtLeft && i === 0) {
      // Already at bottom-left, just draw bottom and right side
      d += ` L ${right - R} ${depth}`
      d += ` Q ${right} ${depth} ${right} ${depth - R}`
      d += ` L ${right} ${barH + R}`
      d += ` Q ${right} ${barH} ${right + R} ${barH}`
      continue
    }

    d += ` L ${left - R} ${barH}`
    d += ` Q ${left} ${barH} ${left} ${barH + R}`
    d += ` L ${left} ${depth - R}`
    d += ` Q ${left} ${depth} ${left + R} ${depth}`

    if (touchesRight) {
      d += ` L ${width} ${depth}`
      continue
    }

    d += ` L ${right - R} ${depth}`
    d += ` Q ${right} ${depth} ${right} ${depth - R}`
    d += ` L ${right} ${barH + R}`
    d += ` Q ${right} ${barH} ${right + R} ${barH}`
  }

  if (!sorted[sorted.length - 1] || sorted[sorted.length - 1].right < width - 1) {
    d += ` L ${width} ${barH}`
  }
  return d
}

export function TabBarOutline({ containerRef, barH, jutH, shallowH }: {
  containerRef: React.RefObject<HTMLDivElement | null>
  barH: number
  jutH: number
  shallowH: number
}) {
  const [path, setPath] = useState("")
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function measure() {
      const cr = container!.getBoundingClientRect()
      const juts = Array.from(container!.querySelectorAll("[data-tabbar-jut]")).flatMap((el) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const clip = el.closest(".tabbar-scroll")?.getBoundingClientRect()
        const left = Math.max(r.left, clip?.left ?? cr.left) - cr.left
        const right = Math.min(r.right, clip?.right ?? cr.right) - cr.left
        if (right <= left) return []
        const inactive = (el as HTMLElement).dataset.tabbarJut === "inactive"
        return [{ left, right, depth: inactive ? shallowH : jutH }]
      })
      setWidth(cr.width)
      setPath(buildPath(cr.width, barH, juts))
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    const mo = new MutationObserver(measure)
    mo.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tabbar-jut"] })

    // Follow the full 140ms fade + 220ms slide as well as local height changes.
    let rafId = 0
    let pollEnd = 0
    let debounceId = 0
    function startPoll() {
      pollEnd = performance.now() + 400
      if (rafId) return
      function tick() {
        measure()
        if (performance.now() < pollEnd) { rafId = requestAnimationFrame(tick) }
        else { rafId = 0 }
      }
      rafId = requestAnimationFrame(tick)
    }
    // Debounce so rapid mousedown events don't spam remeasures
    function debouncedPoll() {
      clearTimeout(debounceId)
      debounceId = window.setTimeout(startPoll, 16)
    }
    const moAnim = new MutationObserver((records) => {
      // Measuring updates this SVG. Those writes must not restart its own poll.
      if (records.some((record) => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement
        return !element?.closest("[data-tabbar-outline]")
      })) debouncedPoll()
    })
    moAnim.observe(container, { childList: true, subtree: true, attributes: true, characterData: true })
    container.addEventListener("scroll", measure, true)

    return () => { ro.disconnect(); mo.disconnect(); moAnim.disconnect(); cancelAnimationFrame(rafId); clearTimeout(debounceId); container.removeEventListener("scroll", measure, true) }
  }, [containerRef, barH, jutH, shallowH])

  if (!path || !width) return null

  return (
    <svg data-tabbar-outline style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", zIndex: 1, overflow: "visible" }} width={width} height={jutH + 4}>
      {/* Fill closes the shape back to top so background shows correctly during transitions */}
      <path d={path + ` L ${width} 0 L 0 0 Z`} fill="#ede9fe" stroke="none" />
      <path d={path} fill="none" stroke="#ddd6fe" strokeWidth="1" />
    </svg>
  )
}
