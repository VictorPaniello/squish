import { describe, expect, test } from "bun:test"
import { formatProgressBar } from "../src/progress.ts"

describe("formatProgressBar", () => {
  test("renders an empty bar at 0 completed", () => {
    expect(formatProgressBar(0, 20, 10)).toBe("[----------] 0% (0/20)")
  })

  test("renders a full bar when completed equals total", () => {
    expect(formatProgressBar(20, 20, 10)).toBe("[##########] 100% (20/20)")
  })

  test("renders a partially filled bar, rounded to the nearest cell", () => {
    // 3/10 of a 10-wide bar = 3 filled cells exactly
    expect(formatProgressBar(3, 10, 10)).toBe("[###-------] 30% (3/10)")
  })

  test("never reports more than 100% even if completed somehow exceeds total", () => {
    expect(formatProgressBar(25, 20, 10)).toBe("[##########] 100% (25/20)")
  })

  test("treats a non-positive total as already-complete instead of dividing by zero", () => {
    expect(formatProgressBar(0, 0, 10)).toBe("[##########] 100% (0/0)")
  })

  test("defaults to a 30-cell-wide bar when no width is given", () => {
    const bar = formatProgressBar(15, 30)
    expect(bar.startsWith("[" + "#".repeat(15) + "-".repeat(15) + "]")).toBe(true)
  })
})
