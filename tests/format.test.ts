import { describe, expect, test } from "bun:test"
import { formatBytes, formatSavings } from "../src/format.ts"

describe("formatBytes", () => {
  test("shows KB with no decimal under 1MB", () => {
    expect(formatBytes(842 * 1024)).toBe("842KB")
  })

  test("shows MB with one decimal at 1MB and above", () => {
    expect(formatBytes(3.2 * 1024 * 1024)).toBe("3.2MB")
  })

  test("rounds KB rather than truncating", () => {
    // 1.6KB should round to 2KB, not truncate to 1KB
    expect(formatBytes(1.6 * 1024)).toBe("2KB")
  })
})

describe("formatSavings", () => {
  test("reports a real reduction as negative", () => {
    expect(formatSavings(1000, 660)).toBe("-34%")
  })

  test("reports growth as positive, not hidden as 0% or negative", () => {
    expect(formatSavings(1000, 1120)).toBe("+12%")
  })

  test("no change is -0%, not +0%", () => {
    expect(formatSavings(1000, 1000)).toBe("-0%")
  })
})
