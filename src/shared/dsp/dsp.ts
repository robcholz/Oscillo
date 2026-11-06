// Spectrum and histogram helpers for the plots.

/** In-place radix-2 FFT. `re` and `im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k + len / 2] = re[i + k] - ar
        im[i + k + len / 2] = im[i + k] - ai
        re[i + k] += ar
        im[i + k] += ai
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** Magnitude spectrum in dBV (RMS) with a Hann window, from 0 to fs/2. */
export function spectrum(samples: ArrayLike<number>, fs: number): { f: Float64Array; db: Float64Array } {
  let n = 1
  while (n * 2 <= samples.length) n *= 2
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  let mean = 0
  for (let i = 0; i < n; i++) mean += samples[i]
  mean /= n
  for (let i = 0; i < n; i++) re[i] = (samples[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
  fft(re, im)
  const half = n / 2
  const f = new Float64Array(half)
  const db = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    // ×2 for one-sided, ×2 for the Hann window's coherent gain, /√2 for RMS.
    const mag = (Math.hypot(re[k], im[k]) / n) * 4 / Math.SQRT2
    f[k] = (k * fs) / n
    db[k] = 20 * Math.log10(Math.max(mag, 1e-6))
  }
  return { f, db }
}

export function histogram(v: ArrayLike<number>, min: number, max: number, bins: number): { x: Float64Array; count: Float64Array } {
  const x = new Float64Array(bins)
  const count = new Float64Array(bins)
  for (let i = 0; i < bins; i++) x[i] = min + ((i + 0.5) / bins) * (max - min)
  for (let i = 0; i < v.length; i++) {
    const b = Math.floor(((v[i] - min) / (max - min)) * bins)
    if (b >= 0 && b < bins) count[b]++
  }
  return { x, count }
}
