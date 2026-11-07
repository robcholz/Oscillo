// Waveform shapes shared by the Waveform Generator, Supplies and the scope's simulated inputs.
export type WaveType = 'Sine' | 'Square' | 'Triangle' | 'Ramp Up' | 'Ramp Down' | 'Noise' | 'Trapezium' | 'Sine Power' | 'DC' | 'Custom' | 'Play'

/** One sample, -1…1, at phase p (0…1) with symmetry s (0…1). */
export function shape(type: WaveType, p: number, s = 0.5, custom?: number[]): number {
  p = ((p % 1) + 1) % 1
  switch (type) {
    case 'Sine': {
      // Symmetry stretches the first half-cycle.
      const q = p < s ? (p / s) * 0.5 : 0.5 + ((p - s) / (1 - s)) * 0.5
      return Math.sin(2 * Math.PI * q)
    }
    case 'Square':
      return p < s ? 1 : -1
    case 'Triangle':
      return p < s ? -1 + (2 * p) / s : 1 - (2 * (p - s)) / (1 - s)
    case 'Ramp Up':
      return -1 + 2 * p
    case 'Ramp Down':
      return 1 - 2 * p
    case 'Noise':
      return Math.sin(p * 9173.1) * Math.cos(p * 3371.7)
    case 'Trapezium': {
      const r = 0.125
      if (p < r) return -1 + (2 * p) / r
      if (p < 0.5) return 1
      if (p < 0.5 + r) return 1 - (2 * (p - 0.5)) / r
      return -1
    }
    case 'Sine Power': {
      const v = Math.sin(2 * Math.PI * p)
      return Math.sign(v) * Math.abs(v) ** (1 + (s - 0.5) * 6)
    }
    case 'DC':
      return 0
    case 'Custom':
    case 'Play': {
      const pts = custom ?? [0, 0.6, 0.4, 0.8, 0.1, -0.6, -0.3, -0.8, -0.1, 0.3, 0]
      const x = p * (pts.length - 1)
      const i = Math.floor(x)
      return pts[i] + (pts[Math.min(i + 1, pts.length - 1)] - pts[i]) * (x - i)
    }
  }
}

export function samples(type: WaveType, opts: { freq: number; amp: number; offset: number; sym: number; phase: number; periods?: number; n?: number; custom?: number[] }): { t: Float64Array; v: Float64Array } {
  const n = opts.n ?? 600
  const periods = opts.periods ?? 2
  const t = new Float64Array(n)
  const v = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = (i / (n - 1)) * periods
    t[i] = p / opts.freq
    v[i] = opts.offset + (type === 'DC' ? 0 : opts.amp * shape(type, p + opts.phase / 360, opts.sym / 100, opts.custom))
  }
  return { t, v }
}
