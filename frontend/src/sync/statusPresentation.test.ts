import { describe, expect, test } from "bun:test"
import { syncIndicatorKind, syncStateColor } from "./statusPresentation"

describe("sync status presentation", () => {
  test("uses a spinner while local work is waiting and fades the same neutral spinner after acknowledgement", () => {
    expect(syncIndicatorKind("pending")).toBe("spinner")
    expect(syncIndicatorKind("synced")).toBe("synced_fade")
  })

  test("uses a soft error treatment and retains local-only as a distinct state", () => {
    expect(syncIndicatorKind("error")).toBe("error")
    expect(syncIndicatorKind("local_only")).toBe("local_only")
    expect(syncStateColor("error")).toBe("#c47f7f")
  })
})
