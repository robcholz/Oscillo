// The simulated analog front end behind the Oscilloscope: what an Analog Discovery 3 sees with
// Wavegen 1 (1 kHz, 2 V sine) on C1 and a 3.3 V logic clock on C2. Replace with the WaveForms
// runtime once it is wired in; the view only depends on `capture()` and `measure()`.
import { compile } from './expr'

export interface ChannelCfg {
  on: boolean
  offset: number
  /** Volts per division. */
  range: number
  probe: number
  coupling: 'DC' | 'AC'
}

export interface ScopeCfg {
  /** Seconds per division. */
  base: number
  /** Trigger position, seconds. */
  position: number
  triggerSource: 'Channel 1' | 'Channel 2' | string
  triggerMode: 'Auto' | 'Normal' | 'None'
  condition: 'Rising' | 'Falling' | 'Either'
  level: number
  ch: Record<'C1' | 'C2', ChannelCfg>
  math: string
}

export interface Capture {
  t: Float64Array
  C1: Float64Array
  C2: Float64Array
  M1: Float64Array
  triggered: boolean
  mathError: string | null
}

const F = 1000
const AMP = 2
const RISE = 48e-9

function c1(t: number, noise: number): number {
  return AMP * Math.sin(2 * Math.PI * F * t) + noise
}
function c2(t: number, noise: number): number {
  // 3.3 V square in phase with C1, edges with a 48 ns 10–90 % rise.
  const ph = (((t * F) % 1) + 1) % 1
  const edge = (x: number): number => Math.min(1, Math.max(0, x / (RISE * F * 1.25)))
  const hi = ph < 0.5 ? edge(ph) : 1 - edge(ph - 0.5)
  return 3.3 * hi + noise
}

let seed = 1
function rand(): number {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}
function noise(level: number): number {
  return (rand() + rand() + rand() - 1.5) * level
}

/** Time of the trigger crossing within one period of the source, or null when the level is out of reach. */
function triggerPhase(cfg: ScopeCfg): number | null {
  const src = cfg.triggerSource === 'Channel 2' ? 'C2' : 'C1'
  if (src === 'C1') {
    if (Math.abs(cfg.level) >= AMP) return null
    const a = Math.asin(cfg.level / AMP) / (2 * Math.PI * F)
    return cfg.condition === 'Falling' ? 0.5 / F - a : a
  }
  if (cfg.level <= 0 || cfg.level >= 3.3) return null
  const frac = (cfg.level / 3.3) * RISE * 1.25
  return cfg.condition === 'Falling' ? 0.5 / F + frac : frac
}

export function capture(cfg: ScopeCfg, n = 2000, free = Math.random()): Capture {
  const tp = cfg.triggerMode === 'None' ? null : triggerPhase(cfg)
  const triggered = tp !== null
  // Untriggered (Auto timeout or None) captures roll at a random phase.
  const t0 = triggered ? tp : free / F
  const span = cfg.base * 10
  const start = cfg.position - span / 2
  const t = new Float64Array(n)
  const a = new Float64Array(n)
  const b = new Float64Array(n)
  const m = new Float64Array(n)
  let mathError: string | null = null
  let fm: ReturnType<typeof compile> | null = null
  try {
    fm = compile(cfg.math)
  } catch (e) {
    mathError = (e as Error).message
  }
  for (let i = 0; i < n; i++) {
    const ti = start + (i / (n - 1)) * span
    t[i] = ti
    const v1 = c1(ti + t0, noise(0.012))
    // AC coupling removes the DC part: C1 has none, C2 sits at 1.65 V.
    const v2 = c2(ti + t0, noise(0.01)) - (cfg.ch.C2.coupling === 'AC' ? 1.65 : 0)
    a[i] = v1
    b[i] = v2
    if (fm) {
      try {
        m[i] = fm({ C1: v1, C2: v2, R1: c1(ti + t0 + 0.05 / F, 0) * 0.9 })
      } catch (e) {
        mathError = (e as Error).message
        fm = null
      }
    }
  }
  return { t, C1: a, C2: b, M1: m, triggered, mathError }
}

/** R1: a stored snapshot of C1, slightly out of phase and smaller, as captured at 12:01:44. */
export function reference(t: Float64Array): Float64Array {
  return Float64Array.from(t, (ti) => 0.9 * AMP * Math.sin(2 * Math.PI * F * (ti + 0.05 / F)))
}

export interface Stats {
  frequency: number
  period: number
  vpp: number
  amplitude: number
  rms: number
  acRms: number
  mean: number
  max: number
  min: number
  rise: number
  fall: number
  dutyPos: number
  widthPos: number
  overshoot: number
}

/** Measurements over a long, fine capture (independent of the zoom shown). */
export function measure(name: 'C1' | 'C2' | 'M1', cfg: ScopeCfg): Stats {
  const n = 8192
  const span = 8 / F
  const c = capture({ ...cfg, base: span / 10, position: span / 2 - 0 }, n)
  const v = c[name]
  let max = -Infinity
  let min = Infinity
  let sum = 0
  let sq = 0
  for (let i = 0; i < n; i++) {
    max = Math.max(max, v[i])
    min = Math.min(min, v[i])
    sum += v[i]
    sq += v[i] * v[i]
  }
  const mean = sum / n
  const rms = Math.sqrt(sq / n)
  const acRms = Math.sqrt(Math.max(0, sq / n - mean * mean))
  const mid = (max + min) / 2
  // Crossings with 10 % hysteresis, so noise near the midpoint doesn't count extra edges.
  const hyst = (max - min) * 0.1
  const ups: number[] = []
  let above = 0
  let armed = v[0] < mid - hyst
  for (let i = 1; i < n; i++) {
    if (v[i] < mid - hyst) armed = true
    if (armed && v[i - 1] < mid && v[i] >= mid) {
      const f = (mid - v[i - 1]) / (v[i] - v[i - 1])
      ups.push(c.t[i - 1] + f * (c.t[i] - c.t[i - 1]))
      armed = false
    }
    if (v[i] >= mid) above++
  }
  const period = ups.length > 1 ? (ups[ups.length - 1] - ups[0]) / (ups.length - 1) : NaN
  const dutyPos = above / (n - 1)
  const isSquare = name === 'C2'
  const jitter = (): number => 1 + (rand() - 0.5) * 0.06
  return {
    frequency: 1 / period,
    period,
    vpp: max - min,
    amplitude: (max - min) / 2,
    rms,
    acRms,
    mean,
    max,
    min,
    rise: isSquare ? RISE * jitter() : (0.8 * period) / Math.PI / 2 * 1.85,
    fall: isSquare ? 51e-9 * jitter() : (0.8 * period) / Math.PI / 2 * 1.85,
    dutyPos,
    widthPos: dutyPos * period,
    overshoot: isSquare ? 0.012 * jitter() : 0
  }
}
