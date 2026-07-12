import { beforeEach, describe, expect, test } from "bun:test"
import { clearReauthRequired, isReauthRequired, notifyReauthRequired } from "./reauthSignal"

beforeEach(() => {
  clearReauthRequired()
})

describe("reauth signal", () => {
  test("latches until cleared", () => {
    expect(isReauthRequired()).toBe(false)
    notifyReauthRequired()
    notifyReauthRequired()

    expect(isReauthRequired()).toBe(true)

    clearReauthRequired()
    expect(isReauthRequired()).toBe(false)
  })
})
