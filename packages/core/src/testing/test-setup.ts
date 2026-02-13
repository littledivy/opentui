// Disable sanitizers globally — these tests use FFI resources.
const _orig = Deno.test
Deno.test = function (first: any, ...rest: any[]) {
  const opts = { sanitizeOps: false, sanitizeResources: false, sanitizeExit: false }
  if (typeof first === "string") return _orig({ name: first, fn: rest[0], ...opts })
  if (typeof first === "object") return _orig({ ...first, ...opts })
  if (typeof first === "function") return _orig({ name: first.name, fn: first, ...opts })
  return _orig(first, ...rest)
} as typeof Deno.test

// Override toBeNull — the built-in @std/expect version crashes on FFI
// null-prototype pointer objects ("Cannot convert object to primitive value").
import { expect } from "jsr:@std/expect"
expect.extend({
  toBeNull(ctx: any) {
    const v = ctx.value
    const pass = v === null
    const r = (() => { try { return String(v) } catch { return "[object]" } })()
    return { pass, message: () => pass ? `Expected ${r} not to be null` : `Expected ${r} to be null` }
  },
})

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
