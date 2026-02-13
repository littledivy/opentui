import "../testing/test-setup.ts"
import { test, describe, afterEach } from "jsr:@std/testing/bdd"
import { expect } from "jsr:@std/expect"
import { stub, type Stub } from "jsr:@std/testing/mock"
import { isValidBorderStyle, parseBorderStyle, type BorderStyle } from "./border"

describe("isValidBorderStyle", () => {
  test("returns true for valid border styles", () => {
    expect(isValidBorderStyle("single")).toBe(true)
    expect(isValidBorderStyle("double")).toBe(true)
    expect(isValidBorderStyle("rounded")).toBe(true)
    expect(isValidBorderStyle("heavy")).toBe(true)
  })

  test("returns false for invalid border styles", () => {
    expect(isValidBorderStyle("invalid")).toBe(false)
    expect(isValidBorderStyle("")).toBe(false)
    expect(isValidBorderStyle(null)).toBe(false)
    expect(isValidBorderStyle(undefined)).toBe(false)
    expect(isValidBorderStyle(123)).toBe(false)
    expect(isValidBorderStyle({})).toBe(false)
    expect(isValidBorderStyle([])).toBe(false)
  })
})

describe("parseBorderStyle", () => {
  let warnSpy: Stub<Console>

  afterEach(() => {
    warnSpy?.restore()
  })

  test("returns valid border styles unchanged", () => {
    expect(parseBorderStyle("single")).toBe("single")
    expect(parseBorderStyle("double")).toBe("double")
    expect(parseBorderStyle("rounded")).toBe("rounded")
    expect(parseBorderStyle("heavy")).toBe("heavy")
  })

  test("falls back to 'single' for invalid string values", () => {
    warnSpy = stub(console, "warn", () => {})

    expect(parseBorderStyle("invalid")).toBe("single")
    expect(parseBorderStyle("")).toBe("single")
    expect(parseBorderStyle("SINGLE")).toBe("single") // case sensitive
    expect(parseBorderStyle("Single")).toBe("single")
  })

  test("falls back to custom fallback for invalid values", () => {
    warnSpy = stub(console, "warn", () => {})

    expect(parseBorderStyle("invalid", "double")).toBe("double")
    expect(parseBorderStyle("invalid", "rounded")).toBe("rounded")
    expect(parseBorderStyle("invalid", "heavy")).toBe("heavy")
  })

  test("falls back silently for undefined/null without warning", () => {
    warnSpy = stub(console, "warn", () => {})

    expect(parseBorderStyle(undefined)).toBe("single")
    expect(parseBorderStyle(null)).toBe("single")
    expect(warnSpy.calls.length).toBe(0)
  })

  test("logs warning for invalid non-null/undefined values", () => {
    warnSpy = stub(console, "warn", () => {})

    parseBorderStyle("invalid-style")

    expect(warnSpy.calls.length).toBe(1)
    expect(warnSpy.calls[0]?.args[0]).toBe(
      'Invalid borderStyle "invalid-style", falling back to "single". Valid values are: single, double, rounded, heavy',
    )
  })

  describe("regression: does not crash with unexpected value types", () => {
    test("handles invalid values", () => {
      warnSpy = stub(console, "warn", () => {})

      expect(parseBorderStyle(123 as unknown as BorderStyle)).toBe("single")
      expect(parseBorderStyle({} as unknown as BorderStyle)).toBe("single")
      expect(parseBorderStyle(true as unknown as BorderStyle)).toBe("single")
      expect(parseBorderStyle((() => "single") as unknown as BorderStyle)).toBe("single")
    })
  })
})
