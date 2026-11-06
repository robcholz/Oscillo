// Simulated devices under test for the Network and Impedance analyzers.

export interface Complex {
  re: number
  im: number
}
const c = (re: number, im = 0): Complex => ({ re, im })
const add = (a: Complex, b: Complex) => c(a.re + b.re, a.im + b.im)
const mul = (a: Complex, b: Complex) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
const div = (a: Complex, b: Complex) => {
  const d = b.re * b.re + b.im * b.im
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
export const mag = (a: Complex) => Math.hypot(a.re, a.im)
export const phaseDeg = (a: Complex) => (Math.atan2(a.im, a.re) * 180) / Math.PI

/** Sallen-Key low-pass: fc = 10 kHz, Q = 0.707, unity gain. */
export function lowPass(f: number, fc = 10000, q = 0.707): Complex {
  const s = c(0, f / fc)
  return div(c(1), add(add(mul(s, s), c(s.re / q, s.im / q)), c(1)))
}

/** Sweep frequencies, log or linear. */
export function sweep(start: number, stop: number, steps: number, log: boolean): number[] {
  return Array.from({ length: steps }, (_, i) => {
    const k = steps === 1 ? 0 : i / (steps - 1)
    return log ? start * (stop / start) ** k : start + (stop - start) * k
  })
}

/** Impedance of the demo DUT: 1 kΩ in series with 100 nF, in parallel with 10 pF of fixture. */
export function impedance(f: number, dut: 'RC' | 'L' | 'R' = 'RC'): Complex {
  const w = 2 * Math.PI * f
  const z = dut === 'R' ? c(1000) : dut === 'L' ? c(2.4, w * 100e-6) : c(1000, -1 / (w * 100e-9))
  const zp = c(0, -1 / (w * 10e-12))
  return div(mul(z, zp), add(z, zp))
}
