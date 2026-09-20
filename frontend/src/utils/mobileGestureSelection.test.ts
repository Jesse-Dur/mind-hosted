import { describe, expect, test } from "bun:test"
import { suppressNativeSelection } from "./mobileGestureSelection"

describe("mobile tile selection suppression", () => {
  test("blocks selection for the whole gesture and restores prior styles", () => {
    let selectStart: EventListener | null = null
    let prevented = false
    let clears = 0
    const owner = {
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => { selectStart = listener as EventListener },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (selectStart === listener) selectStart = null
      },
    }
    const body = { style: { userSelect: "text", webkitUserSelect: "auto" } }
    const release = suppressNativeSelection(
      owner as Pick<Document, "addEventListener" | "removeEventListener">,
      body,
      { removeAllRanges: () => { clears += 1 } },
    )

    selectStart?.({ preventDefault: () => { prevented = true } } as Event)
    expect(prevented).toBe(true)
    expect(body.style).toEqual({ userSelect: "none", webkitUserSelect: "none" })
    expect(clears).toBe(1)

    release()
    release()
    expect(selectStart).toBeNull()
    expect(body.style).toEqual({ userSelect: "text", webkitUserSelect: "auto" })
    expect(clears).toBe(2)
  })
})
