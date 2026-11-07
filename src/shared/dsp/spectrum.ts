// Spectrum analysis for the Spectrum Analyzer: windows, amplitude-correct dBV spectra and the
// dynamic measurements (noise floor, SNR, THD, SINAD, ENOB, SFDR) computed from the bins.
import { fft } from './dsp'

export const WINDOWS = ['Flat Top', 'Hann', 'Hamming', 'Blackman-Harris', 'Cosine', 'Triangular', 'Kaiser', 'Rectangular'] as const
export type WindowName = (typeof WINDOWS)[number]

function bessel0(x: number): number {
  let s = 1
  let t = 1
  for (let k = 1; k < 30; k++) {
    t *= (x / (2 * k)) ** 2
    s += t
  }
  return s
}

export function windowFn(name: WindowName, n: number, beta = 8): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / (n - 1)
    switch (name) {
      case 'Flat Top':
        w[i] = 0.21557895 - 0.41663158 * Math.cos(x) + 0.277263158 * Math.cos(2 * x) - 0.083578947 * Math.cos(3 * x) + 0.006947368 * Math.cos(4 * x)
        break
      case 'Hann':
        w[i] = 0.5 - 0.5 * Math.cos(x)
        break
      case 'Hamming':
        w[i] = 0.54 - 0.46 * Math.cos(x)
        break
      case 'Blackman-Harris':
        w[i] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x)
        break
      case 'Cosine':
        w[i] = Math.sin((Math.PI * i) / (n - 1))
        break
      case 'Triangular':
        w[i] = 1 - Math.abs((i - (n - 1) / 2) / ((n - 1) / 2))
        break
      case 'Kaiser': {
        const r = (2 * i) / (n - 1) - 1
        w[i] = bessel0(beta * Math.sqrt(1 - r * r)) / bessel0(beta)
        break
      }
      default:
        w[i] = 1
    }
  }
  return w
}

export interface Spectrum {
  f: Float64Array
  /** RMS volts per bin. */
  vrms: Float64Array
  /** Equivalent noise bandwidth in bins. */
  enbw: number
  binHz: number
}

/** Amplitude-correct one-sided spectrum in V RMS. */
export function analyze(samples: ArrayLike<number>, fs: number, win: WindowName, beta = 8): Spectrum {
  let n = 1
  while (n * 2 <= samples.length) n *= 2
  const w = windowFn(win, n, beta)
  let sum = 0
  let sq = 0
  for (let i = 0; i < n; i++) (sum += w[i]), (sq += w[i] * w[i])
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = samples[i] * w[i]
  fft(re, im)
  const half = n / 2 + 1
  const f = new Float64Array(half)
  const vrms = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    f[k] = (k * fs) / n
    const peak = (Math.hypot(re[k], im[k]) / sum) * (k === 0 ? 1 : 2)
    vrms[k] = k === 0 ? peak : peak / Math.SQRT2
  }
  return { f, vrms, enbw: (n * sq) / (sum * sum), binHz: fs / n }
}

export const toDbv = (v: number) => 20 * Math.log10(Math.max(v, 1e-9))

export interface Metrics {
  fundamental: { f: number; dbv: number }
  harmonics: { n: number; f: number; dbv: number }[]
  noiseFloor: number
  snr: number
  thd: number
  sinad: number
  enob: number
  sfdr: number
}

/** Fundamental, harmonics and dynamic measurements from a spectrum. */
export function metrics(s: Spectrum, harmonics = 5): Metrics {
  const n = s.vrms.length
  const span = Math.max(3, Math.ceil(s.enbw * 2))
  let k0 = 1
  for (let k = 2; k < n; k++) if (s.vrms[k] > s.vrms[k0]) k0 = k
  const power = (k: number) => {
    let p = 0
    for (let j = Math.max(1, k - span); j <= Math.min(n - 1, k + span); j++) p += s.vrms[j] ** 2
    return p / s.enbw
  }
  const pf = power(k0)
  const used = new Set<number>()
  for (let j = 0; j <= span; j++) used.add(j)
  const mark = (k: number) => {
    for (let j = k - span; j <= k + span; j++) used.add(j)
  }
  mark(k0)
  const harm: Metrics['harmonics'] = []
  let ph = 0
  for (let h = 2; h <= harmonics; h++) {
    const k = k0 * h
    if (k + span >= n) break
    let best = k
    for (let j = k - 2; j <= k + 2; j++) if (s.vrms[j] > s.vrms[best]) best = j
    const p = power(best)
    ph += p
    mark(best)
    harm.push({ n: h, f: s.f[best], dbv: 10 * Math.log10(Math.max(p, 1e-18)) })
  }
  let pn = 0
  let spur = 0
  let count = 0
  for (let k = 1; k < n; k++)
    if (!used.has(k)) {
      pn += s.vrms[k] ** 2
      count++
      spur = Math.max(spur, s.vrms[k])
    }
  pn /= s.enbw
  const maxHarm = Math.max(spur ** 2, ...harm.map((h) => 10 ** (h.dbv / 10)))
  const sinad = 10 * Math.log10(pf / (pn + ph))
  // Parabolic interpolation on log magnitude refines the peak frequency between bins.
  const [a, b, c] = [k0 - 1, k0, k0 + 1].map((k) => Math.log(Math.max(s.vrms[k] ?? 1e-12, 1e-12)))
  const delta = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0
  return {
    fundamental: { f: (k0 + delta) * s.binHz, dbv: 10 * Math.log10(pf) },
    harmonics: harm,
    noiseFloor: toDbv(Math.sqrt(pn / Math.max(1, count))),
    snr: 10 * Math.log10(pf / pn),
    thd: 10 * Math.log10(ph / pf),
    sinad,
    enob: (sinad - 1.76) / 6.02,
    sfdr: 10 * Math.log10(pf / maxHarm)
  }
}
