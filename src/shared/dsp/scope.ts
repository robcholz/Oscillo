// Oscilloscope captures: the channel settings, a capture built from device samples (with math), and
// the measurements over a record.
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

/** Measurements over any record (a hardware capture): levels, period from mid-level crossings, 10–90 % edges. */
export function stats(t: ArrayLike<number>, v: ArrayLike<number>): Stats {
  const n = Math.min(t.length, v.length)
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
  const vpp = max - min
  const at = (lvl: number, from: number, dir: 1 | -1): number => {
    for (let i = Math.max(1, from); i < n; i++) {
      const a = v[i - 1] - lvl
      const b = v[i] - lvl
      if ((dir === 1 && a < 0 && b >= 0) || (dir === -1 && a > 0 && b <= 0)) return t[i - 1] + (a / (a - b)) * (t[i] - t[i - 1])
    }
    return NaN
  }
  const mid = (max + min) / 2
  const hyst = vpp * 0.1
  const ups: number[] = []
  let above = 0
  let armed = v[0] < mid - hyst
  for (let i = 1; i < n; i++) {
    if (v[i] < mid - hyst) armed = true
    if (armed && v[i - 1] < mid && v[i] >= mid) {
      ups.push(t[i - 1] + ((mid - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]))
      armed = false
    }
    if (v[i] >= mid) above++
  }
  const period = ups.length > 1 ? (ups[ups.length - 1] - ups[0]) / (ups.length - 1) : NaN
  // Edge times on the first full edge after the record starts.
  const i0 = 0
  const lo = min + 0.1 * vpp
  const hi = min + 0.9 * vpp
  const r10 = at(lo, i0, 1)
  const rise = at(hi, i0, 1) - r10
  const f90 = at(hi, i0, -1)
  const fall = at(lo, i0, -1) - f90
  const dutyPos = above / Math.max(1, n - 1)
  const sorted = Float64Array.from({ length: n }, (_, i) => v[i]).sort()
  const top = sorted[Math.floor(n * 0.9)]
  return { frequency: 1 / period, period, vpp, amplitude: vpp / 2, rms, acRms, mean, max, min, rise: rise > 0 ? rise : NaN, fall: fall > 0 ? fall : NaN, dutyPos, widthPos: dutyPos * period, overshoot: vpp ? Math.max(0, (max - top) / vpp) : 0 }
}

/** A capture from samples recorded on a device: times centred on the trigger position, plus math. */
export function fromSamples(cfg: ScopeCfg, rate: number, c1: Float64Array | null, c2: Float64Array | null): Capture {
  const n = (c1 ?? c2)?.length ?? 0
  const t = new Float64Array(n)
  const start = cfg.position - n / rate / 2
  for (let i = 0; i < n; i++) t[i] = start + i / rate
  const a = c1 ?? new Float64Array(n)
  const b = c2 ?? new Float64Array(n)
  const m = new Float64Array(n)
  let mathError: string | null = null
  try {
    const fm = compile(cfg.math)
    for (let i = 0; i < n; i++) m[i] = fm({ C1: a[i], C2: b[i], R1: 0 })
  } catch (e) {
    mathError = (e as Error).message
  }
  return { t, C1: a, C2: b, M1: m, triggered: true, mathError }
}
