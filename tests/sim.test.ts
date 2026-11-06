import { describe, expect, it } from 'vitest'
import { axisTicks, si } from '../src/renderer/src/components/format'
import { parseSi } from '../src/renderer/src/components/UnitInput'
import { check, compile } from '../src/renderer/src/sim/expr'
import { spectrum } from '../src/renderer/src/sim/dsp'

describe('math formulas', () => {
  it('evaluates with precedence and functions', () => {
    expect(compile('C1 - C2 / 2')({ C1: 3, C2: 2 })).toBe(2)
    expect(compile('abs(-C1) ^ 2 + max(1, 4)')({ C1: 3 })).toBe(13)
    expect(compile('-(C1 + 1) * 2')({ C1: 1 })).toBe(-4)
  })
  it('explains bad formulas', () => {
    expect(check('C1 +', ['C1'])).toMatch(/ends too early/)
    expect(check('C9 * 2', ['C1'])).toMatch(/Unknown channel C9/)
    expect(check('foo(C1)', ['C1'])).toMatch(/Unknown function/)
    expect(check('C1; alert(1)', ['C1'])).toMatch(/Unexpected character/)
  })
})

describe('formatting', () => {
  it('uses engineering prefixes', () => {
    expect(si(0.000047, 's')).toBe('47.0 µs')
    expect(si(4096000, 'S/s', 4)).toBe('4.096 MS/s')
    expect(si(0, 'V')).toBe('0 V')
  })
  it('labels axis ends with units and inner ticks without', () => {
    expect(axisTicks([-1e-3, -6e-4, -2e-4, 2e-4, 6e-4, 1e-3], 's')).toEqual(['-1 ms', '-0.6', '-0.2', '0.2', '0.6', '1 ms'])
  })
  it('parses SI suffixes', () => {
    expect(parseSi('200u')).toBeCloseTo(200e-6)
    expect(parseSi('1.5k')).toBe(1500)
    expect(parseSi('abc')).toBeNull()
  })
})

describe('spectrum', () => {
  it('finds a 1 kHz, 1 V RMS sine at 0 dBV', () => {
    const fs = 100_000
    const x = Float64Array.from({ length: 8192 }, (_, i) => Math.SQRT2 * Math.sin((2 * Math.PI * 1000 * i) / fs))
    const { f, db } = spectrum(x, fs)
    let k = 0
    for (let i = 1; i < db.length; i++) if (db[i] > db[k]) k = i
    expect(f[k]).toBeGreaterThan(980)
    expect(f[k]).toBeLessThan(1020)
    expect(db[k]).toBeGreaterThan(-1.5)
    expect(db[k]).toBeLessThan(0.5)
  })
})
