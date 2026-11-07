import { describe, expect, test } from "bun:test"
import { observeMobileKeyboardDismiss } from "./mobileThoughtEditing"

function viewportFixture(visual = true) {
  const viewport = Object.assign(new EventTarget(), { height: 915, scale: 1 })
  const owner = Object.assign(new EventTarget(), { innerWidth: 412, innerHeight: 915, visualViewport: visual ? viewport : null })
  let dismissals = 0
  const cleanup = observeMobileKeyboardDismiss(() => { dismissals++ }, owner as unknown as Window)
  function resize(height: number) {
    viewport.height = height
    owner.innerHeight = height
    viewport.dispatchEvent(new Event("resize"))
    owner.dispatchEvent(new Event("resize"))
  }
  return { owner, viewport, resize, cleanup, dismissals: () => dismissals }
}

describe("mobile thought keyboard dismissal", () => {
  test("finishes once after an observed keyboard opens and closes, including animated resizes", () => {
    const fixture = viewportFixture()
    for (const height of [850, 750, 650, 560, 580, 700, 800]) fixture.resize(height)
    expect(fixture.dismissals()).toBe(0)
    fixture.resize(915)
    fixture.resize(915)
    expect(fixture.dismissals()).toBe(1)
    fixture.resize(560)
    fixture.resize(915)
    expect(fixture.dismissals()).toBe(2)
    fixture.cleanup()
  })

  test("ignores browser toolbar movement without an observed keyboard", () => {
    const fixture = viewportFixture()
    for (const height of [840, 880, 915, 970, 895, 970]) fixture.resize(height)
    expect(fixture.dismissals()).toBe(0)
    fixture.cleanup()
  })

  test("allows the toolbar to have moved when the keyboard closes", () => {
    const fixture = viewportFixture()
    fixture.resize(560)
    fixture.resize(860)
    expect(fixture.dismissals()).toBe(1)
    fixture.cleanup()
  })

  test("does not treat changing keyboard height as dismissal", () => {
    const fixture = viewportFixture()
    for (const height of [540, 650, 580, 700, 610]) fixture.resize(height)
    expect(fixture.dismissals()).toBe(0)
    fixture.cleanup()
  })

  test("resets on rotation rather than blurring the thought", () => {
    const fixture = viewportFixture()
    fixture.resize(560)
    fixture.owner.innerWidth = 915
    fixture.resize(412)
    fixture.resize(300)
    fixture.resize(412)
    expect(fixture.dismissals()).toBe(0)
    fixture.resize(220)
    fixture.resize(412)
    expect(fixture.dismissals()).toBe(1)
    fixture.cleanup()
  })

  test("ignores pinch zoom and establishes a new baseline when zoom ends", () => {
    const fixture = viewportFixture()
    fixture.viewport.scale = 2
    fixture.resize(450)
    fixture.resize(300)
    fixture.resize(450)
    fixture.viewport.scale = 1
    fixture.resize(915)
    expect(fixture.dismissals()).toBe(0)
    fixture.resize(560)
    fixture.resize(915)
    expect(fixture.dismissals()).toBe(1)
    fixture.cleanup()
  })

  test("falls back to window resize when VisualViewport is unavailable", () => {
    const fixture = viewportFixture(false)
    fixture.resize(560)
    fixture.resize(915)
    expect(fixture.dismissals()).toBe(1)
    fixture.cleanup()
  })

  test("removes both listeners on unmount", () => {
    const fixture = viewportFixture()
    fixture.resize(560)
    fixture.cleanup()
    fixture.resize(915)
    expect(fixture.dismissals()).toBe(0)
  })
})
