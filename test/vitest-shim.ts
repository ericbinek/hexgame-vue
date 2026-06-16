// Winziger vitest-Ersatz: bildet die im Kern genutzte API (describe/it/expect +
// 16 Matcher) auf node:test + node:assert ab. So laufen die unveränderten
// *.test.ts ohne das vitest-Paket — 0 zusätzliche Lieferkette.
// esbuild aliast 'vitest' auf diese Datei (siehe package.json test-Script).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

export { describe, it }

type Throwable = string | RegExp | (new (...args: any[]) => any)

function matchers(actual: any, negate: boolean) {
  const ok = (cond: boolean, msg: string) =>
    assert.ok(negate ? !cond : cond, (negate ? 'NOT ' : '') + msg)
  return {
    toBe(expected: any) {
      negate ? assert.notStrictEqual(actual, expected) : assert.strictEqual(actual, expected)
    },
    toEqual(expected: any) {
      negate ? assert.notDeepStrictEqual(actual, expected) : assert.deepStrictEqual(actual, expected)
    },
    toStrictEqual(expected: any) {
      negate ? assert.notDeepStrictEqual(actual, expected) : assert.deepStrictEqual(actual, expected)
    },
    toBeGreaterThan(n: number) { ok(actual > n, `${actual} > ${n}`) },
    toBeGreaterThanOrEqual(n: number) { ok(actual >= n, `${actual} >= ${n}`) },
    toBeLessThan(n: number) { ok(actual < n, `${actual} < ${n}`) },
    toBeLessThanOrEqual(n: number) { ok(actual <= n, `${actual} <= ${n}`) },
    toHaveLength(n: number) { ok(actual?.length === n, `length ${actual?.length} === ${n}`) },
    toContain(item: any) {
      const has = Array.isArray(actual) ? actual.includes(item) : String(actual).includes(item)
      ok(has, `contains ${String(item)}`)
    },
    toContainEqual(item: any) {
      const has = Array.isArray(actual) && actual.some((x: any) => {
        try { assert.deepStrictEqual(x, item); return true } catch { return false }
      })
      ok(has, `containsEqual`)
    },
    toBeNull() { ok(actual === null, `=== null`) },
    toBeUndefined() { ok(actual === undefined, `=== undefined`) },
    toBeDefined() { ok(actual !== undefined, `!== undefined`) },
    toBeTruthy() { ok(!!actual, `truthy`) },
    toBeFalsy() { ok(!actual, `falsy`) },
    toThrow(expected?: Throwable) {
      const run = () => (typeof actual === 'function' ? actual() : undefined)
      if (negate) { assert.doesNotThrow(run); return }
      assert.throws(run, (err: any) => {
        if (expected == null) return true
        if (typeof expected === 'string') return String(err?.message).includes(expected)
        if (expected instanceof RegExp) return expected.test(String(err?.message))
        return err instanceof expected
      })
    },
  }
}

export function expect(actual: any) {
  return Object.assign(matchers(actual, false), { not: matchers(actual, true) })
}
