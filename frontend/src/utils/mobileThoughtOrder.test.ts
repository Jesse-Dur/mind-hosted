import { describe, expect, test } from "bun:test"
import { mobileThoughtInsertionIndex, mobileThoughtOrderIds, sameThoughtOrder } from "./mobileThoughtOrder"

describe("mobile thought ordering", () => {
  test("calculates insertion positions without counting the lifted thought", () => {
    const rows = [
      { id: 1, top: 0, bottom: 40 },
      { id: 2, top: 45, bottom: 85 },
      { id: 3, top: 90, bottom: 130 },
    ]

    expect(mobileThoughtInsertionIndex(rows, 2, 8)).toBe(0)
    expect(mobileThoughtInsertionIndex(rows, 2, 70)).toBe(1)
    expect(mobileThoughtInsertionIndex(rows, 2, 150)).toBe(2)
  })

  test("moves a thought within a tile and clamps cross-tile drops", () => {
    expect(mobileThoughtOrderIds([1, 2, 3], 1, 2)).toEqual([2, 3, 1])
    expect(mobileThoughtOrderIds([4, 5], 9, 20)).toEqual([4, 5, 9])
    expect(sameThoughtOrder([2, 3, 1], [2, 3, 1])).toBe(true)
    expect(sameThoughtOrder([1, 2, 3], [2, 3, 1])).toBe(false)
  })
})
