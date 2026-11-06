// Waveform measurements on a sampled channel, shared by scripts and the MCP server.

export const MEASUREMENTS = ['PeakToPeak', 'Amplitude', 'Maximum', 'Minimum', 'Mean', 'RMS', 'ACRMS', 'Frequency', 'Period', 'RiseTime', 'FallTime', 'DutyCycle'] as const
export type MeasurementName = (typeof MEASUREMENTS)[number]

/** Crossings of the mid level with 10 % hysteresis: [index, rising][] */
function crossings(v: ArrayLike<number>, lo: number, hi: number): [number, boolean][] {
  const mid = (lo + hi) / 2
  const h = (hi - lo) * 0.1
  const out: [number, boolean][] = []
  let state = v[0] > mid ? 1 : 0
  for (let i = 1; i < v.length; i++) {
    if (state === 0 && v[i] > mid + h) {
      state = 1
      out.push([i, true])
    } else if (state === 1 && v[i] < mid - h) {
      state = 0
      out.push([i, false])
    }
  }
  return out
}

/** Time for an edge to go from 10 % to 90 % (or back), averaged over the record; NaN without edges. */
function edgeTime(v: ArrayLike<number>, rate: number, lo: number, hi: number, rising: boolean): number {
  const a = lo + (hi - lo) * 0.1
  const b = lo + (hi - lo) * 0.9
  const times: number[] = []
  let start = -1
  for (let i = 1; i < v.length; i++) {
    if (rising) {
      if (v[i - 1] <= a && v[i] > a) start = i
      if (start >= 0 && v[i - 1] < b && v[i] >= b) (times.push(i - start), (start = -1))
    } else {
      if (v[i - 1] >= b && v[i] < b) start = i
      if (start >= 0 && v[i - 1] > a && v[i] <= a) (times.push(i - start), (start = -1))
    }
  }
  return times.length ? times.reduce((x, y) => x + y, 0) / times.length / rate : NaN
}

export function measure(v: ArrayLike<number>, rate: number, name: MeasurementName): number {
  if (!v.length) return NaN
  let lo = Infinity
  let hi = -Infinity
  let sum = 0
  let sq = 0
  for (let i = 0; i < v.length; i++) {
    lo = Math.min(lo, v[i])
    hi = Math.max(hi, v[i])
    sum += v[i]
    sq += v[i] * v[i]
  }
  const mean = sum / v.length
  const rms = Math.sqrt(sq / v.length)
  switch (name) {
    case 'PeakToPeak':
      return hi - lo
    case 'Amplitude':
      return (hi - lo) / 2
    case 'Maximum':
      return hi
    case 'Minimum':
      return lo
    case 'Mean':
      return mean
    case 'RMS':
      return rms
    case 'ACRMS':
      return Math.sqrt(Math.max(0, rms * rms - mean * mean))
    case 'RiseTime':
      return edgeTime(v, rate, lo, hi, true)
    case 'FallTime':
      return edgeTime(v, rate, lo, hi, false)
  }
  const x = crossings(v, lo, hi)
  const rises = x.filter((c) => c[1]).map((c) => c[0])
  if (rises.length < 2) return NaN
  const period = (rises[rises.length - 1] - rises[0]) / (rises.length - 1) / rate
  if (name === 'Period') return period
  if (name === 'Frequency') return 1 / period
  // DutyCycle: high time over period, from rising edges to the next falling edge.
  let high = 0
  let n = 0
  for (let k = 0; k < x.length - 1; k++)
    if (x[k][1] && !x[k + 1][1]) {
      high += x[k + 1][0] - x[k][0]
      n++
    }
  return n ? (100 * high) / n / rate / period : NaN
}
