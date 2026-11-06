import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { check, compile } from '../src/main/script-compile'
import { measure } from '../src/shared/measure'

const SWEEP = `import { scope, wavegen, File } from "oscillo";

wavegen.channel(1).configure({ type: "Sine", frequency: 1e3, amplitude: 2 });
const capture = await scope.single();
const vpp = capture.channel(1).measure("PeakToPeek");
`

describe('script type check', () => {
  it('flags a misspelt measurement and offers the fix', () => {
    const p = check({ 'a.ts': SWEEP }, 'a.ts')
    expect(p).toHaveLength(1)
    expect(p[0].line).toBe(5)
    expect(p[0].message).toContain('Did you mean "PeakToPeak"?')
    const fixed = SWEEP.slice(0, p[0].fix!.start) + p[0].fix!.text + SWEEP.slice(p[0].fix!.end)
    expect(check({ 'a.ts': fixed }, 'a.ts')).toEqual([])
  })

  it('resolves workspace imports', () => {
    expect(check({ 'a.ts': 'import { kHz } from "./units";\nconst f: number = kHz;\n', 'units.ts': 'export const kHz = 1e3;' }, 'a.ts')).toEqual([])
    expect(check({ 'a.ts': 'import { MHz } from "./units";\n', 'units.ts': 'export const kHz = 1e3;' }, 'a.ts')[0].line).toBe(1)
  })
})

describe('script compile', () => {
  it('calls the line hook before each statement with the variables in scope', async () => {
    const js = compile('let a = 1;\nfor (let i = 0; i < 2; i++) {\n  a += i;\n}\nconst b = a * 2;\n', 'x.ts')
    const seen: [number, Record<string, unknown>][] = []
    const ctx = vm.createContext({ __rt: { line: async (_f: string, n: number, v: () => Record<string, unknown>) => void seen.push([n, v()]) } })
    const fn = vm.runInContext(`(async function (require, exports, module) {\n${js}\n})`, ctx) as (...a: unknown[]) => Promise<void>
    await fn(() => ({}), {}, {})
    expect(seen.map((s) => s[0])).toEqual([1, 2, 3, 3, 5])
    expect(seen[3][1]).toEqual({ a: 1, i: 1 })
    expect(seen[4][1]).toEqual({ a: 2 })
  })
})

describe('measurements', () => {
  it('measures a sine', () => {
    const rate = 100e3
    const v = Float64Array.from({ length: 10000 }, (_, i) => 2 * Math.sin((2 * Math.PI * 1000 * i) / rate) + 0.5)
    expect(measure(v, rate, 'PeakToPeak')).toBeCloseTo(4, 2)
    expect(measure(v, rate, 'Mean')).toBeCloseTo(0.5, 2)
    expect(measure(v, rate, 'Frequency')).toBeCloseTo(1000, 0)
    expect(measure(v, rate, 'ACRMS')).toBeCloseTo(2 / Math.SQRT2, 2)
    expect(measure(v, rate, 'DutyCycle')).toBeCloseTo(50, 0)
  })
})
