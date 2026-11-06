// Complex results and sweep frequencies for the Network and Impedance analyzers.

export interface Complex {
  re: number
  im: number
}

export const mag = (a: Complex) => Math.hypot(a.re, a.im)
export const phaseDeg = (a: Complex) => (Math.atan2(a.im, a.re) * 180) / Math.PI

/** Sweep frequencies, log or linear. */
export function sweep(start: number, stop: number, steps: number, log: boolean): number[] {
  return Array.from({ length: steps }, (_, i) => {
    const k = steps === 1 ? 0 : i / (steps - 1)
    return log ? start * (stop / start) ** k : start + (stop - start) * k
  })
}

