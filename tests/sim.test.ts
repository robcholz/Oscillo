import { describe, expect, it } from 'vitest'
import { axisTicks, si } from '../src/renderer/src/components/format'
import { parseSi } from '../src/renderer/src/components/UnitInput'
import { check, compile } from '../src/renderer/src/sim/expr'
import { spectrum } from '../src/renderer/src/sim/dsp'
import { analyze, metrics, testSignal } from '../src/renderer/src/sim/spectrum'
import { capture as logicCapture, decodeBus, decodeSpi, decodeUart, MOSI_BYTES, pulseStats } from '../src/renderer/src/sim/logic'

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
    expect(axisTicks([20e-3, 10e-3, 0], 'A')).toEqual(['20 mA', '10', '0 A'])
    expect(axisTicks([-1, 0, 1], 'V')).toEqual(['-1 V', '0 V', '1 V'])
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

describe('logic decoders', () => {
  const c = logicCapture(1)
  it('decodes the SPI bytes that were sent', () => {
    expect(decodeSpi(c.signals).map((f) => f.mo)).toEqual(MOSI_BYTES.map((b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0')))
  })
  it('decodes UART characters', () => {
    expect(decodeUart(c.signals.RX).map((f) => f.text)).toEqual(["'O'", "'K'", "'\\r'"])
    expect(decodeUart(c.signals.TX).map((f) => f.text)).toEqual(["'A'", "'T'"])
  })
  it('measures the SPI clock', () => {
    const p = pulseStats(c.signals.SCK)!
    expect(p.period).toBeCloseTo(5e-6, 9)
    expect(p.width).toBeCloseTo(2.5e-6, 9)
  })
  it('merges equal bus values', () => {
    const f = decodeBus(c.signals, ['SCK', 'MOSI', 'MISO', 'CS'])
    for (let i = 1; i < f.length; i++) expect(f[i].text).not.toBe(f[i - 1].text)
  })
})

describe('spectrum metrics', () => {
  const fs = 10000
  const s = analyze(testSignal(16384, fs, 0.1), fs, 'Flat Top')
  const m = metrics(s)
  it('finds the 1 kHz fundamental at −3 dBV', () => {
    expect(m.fundamental.f).toBeCloseTo(1000, -1)
    expect(m.fundamental.dbv).toBeCloseTo(-3.01, 1)
  })
  it('reads the second harmonic near −64 dBV', () => {
    expect(m.harmonics[0].dbv).toBeGreaterThan(-66)
    expect(m.harmonics[0].dbv).toBeLessThan(-62)
  })
  it('gives sensible SNR and ENOB', () => {
    expect(m.snr).toBeGreaterThan(60)
    expect(m.enob).toBeGreaterThan(8)
  })
})
