// Simulated digital captures for the Logic Analyzer: an SPI transfer on DIO 0–3 and a UART exchange
// on DIO 4–5, stored as edge lists, plus real decoders that read those edges back.

export interface DigitalSignal {
  /** Level at t = 0. */
  init: 0 | 1
  /** Toggle times in seconds, ascending. */
  edges: number[]
}

export interface Frame {
  start: number
  end: number
  text: string
  /** Data table columns. */
  mo?: string
  mi?: string
  note?: string
}

export const CAPTURE = { rate: 100e6, samples: 16384 }
export const DURATION = CAPTURE.samples / CAPTURE.rate

function build(init: 0 | 1, changes: [number, 0 | 1][]): DigitalSignal {
  const edges: number[] = []
  let level = init
  for (const [t, v] of changes.sort((a, b) => a[0] - b[0]))
    if (v !== level) {
      edges.push(t)
      level = v
    }
  return { init, edges }
}

export function levelAt(s: DigitalSignal, t: number): 0 | 1 {
  let n = 0
  for (const e of s.edges) {
    if (e > t) break
    n++
  }
  return (n % 2 ? 1 - s.init : s.init) as 0 | 1
}

/** Seeded random so a capture index always looks the same. */
function rng(seed: number) {
  let x = seed * 2654435761 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 10000) / 10000
  }
}

const us = 1e-6
const SPI_T = 5 * us
const BAUD_T = 4 * us

function uart(chars: { c: number; at: number }[]): DigitalSignal {
  const ch: [number, 0 | 1][] = []
  for (const { c, at } of chars) {
    ch.push([at, 0])
    for (let b = 0; b < 8; b++) ch.push([at + (b + 1) * BAUD_T, ((c >> b) & 1) as 0 | 1])
    ch.push([at + 9 * BAUD_T, 1])
  }
  return build(1, ch)
}

export interface Capture {
  index: number
  signals: Record<string, DigitalSignal>
}

export const MOSI_BYTES = [0xa5, 0x3c, 0xf0, 0x0f]

export function capture(index: number): Capture {
  const r = rng(index + 7)
  const miso = [0xff, 0x00, Math.floor(r() * 256), Math.floor(r() * 256)]
  const t0 = 2.4 * us + r() * 0.2 * us
  const sck: [number, 0 | 1][] = []
  const mosi: [number, 0 | 1][] = []
  const misoCh: [number, 0 | 1][] = []
  for (let k = 0; k < 32; k++) {
    const t = t0 + k * SPI_T
    const bit = 7 - (k % 8)
    const byte = Math.floor(k / 8)
    mosi.push([t, ((MOSI_BYTES[byte] >> bit) & 1) as 0 | 1])
    misoCh.push([t, ((miso[byte] >> bit) & 1) as 0 | 1])
    sck.push([t + SPI_T / 2, 1], [t + SPI_T, 0])
  }
  const j = (r() - 0.5) * 2 * us
  return {
    index,
    signals: {
      SCK: build(0, sck),
      MOSI: build(0, mosi),
      MISO: build(0, misoCh),
      CS: build(1, [
        [t0 - 0.4 * us, 0],
        [t0 + 32 * SPI_T + 0.4 * us, 1]
      ]),
      TX: uart([
        { c: 0x41, at: 6 * us + j },
        { c: 0x54, at: 100 * us + j }
      ]),
      RX: uart([
        { c: 0x4f, at: 19.6 * us + j },
        { c: 0x4b, at: 67.1 * us + j },
        { c: 0x0d, at: 115 * us + j }
      ])
    }
  }
}

const hex = (v: number, digits = 2) => '0x' + v.toString(16).toUpperCase().padStart(digits, '0')
const chr = (v: number) => (v === 13 ? "'\\r'" : v === 10 ? "'\\n'" : v >= 32 && v < 127 ? `'${String.fromCharCode(v)}'` : hex(v))

/** SPI mode 0: sample on SCK rising edges while CS is low, MSB first. */
export function decodeSpi(sig: Record<string, DigitalSignal>, pins = { sck: 'SCK', mosi: 'MOSI', miso: 'MISO', cs: 'CS' }): Frame[] {
  const sck = sig[pins.sck]
  const cs = sig[pins.cs]
  if (!sck || !cs) return []
  const frames: Frame[] = []
  let bits = 0
  let mo = 0
  let mi = 0
  let start = 0
  for (const e of sck.edges) {
    if (levelAt(sck, e) !== 1 || levelAt(cs, e) !== 0) continue
    if (bits === 0) start = e - SPI_T / 2
    mo = (mo << 1) | (sig[pins.mosi] ? levelAt(sig[pins.mosi], e - 1e-9) : 0)
    mi = (mi << 1) | (sig[pins.miso] ? levelAt(sig[pins.miso], e - 1e-9) : 0)
    if (++bits === 8) {
      frames.push({ start, end: e + SPI_T / 2, text: hex(mo), mo: hex(mo), mi: hex(mi), note: frames.length === 0 ? 'Start' : '' })
      bits = mo = mi = 0
    }
  }
  return frames
}

/** UART 8N1: find start bits, sample each bit in the middle. */
export function decodeUart(s: DigitalSignal | undefined, bitTime = BAUD_T): Frame[] {
  if (!s) return []
  const frames: Frame[] = []
  let busyUntil = -1
  for (const e of s.edges) {
    if (e < busyUntil || levelAt(s, e) !== 0) continue
    let v = 0
    for (let b = 0; b < 8; b++) v |= levelAt(s, e + (b + 1.5) * bitTime) << b
    const stop = levelAt(s, e + 9.5 * bitTime)
    frames.push({ start: e, end: e + 10 * bitTime, text: chr(v), note: stop ? '' : 'Framing Error' })
    busyUntil = e + 9.5 * bitTime
  }
  return frames
}

/** A parallel bus: one frame per stable value of the member pins (first pin is bit 0). */
export function decodeBus(sig: Record<string, DigitalSignal>, pins: string[]): Frame[] {
  const times = [...new Set(pins.flatMap((p) => sig[p]?.edges ?? []))].sort((a, b) => a - b)
  const bounds = [0, ...times, DURATION]
  const frames: Frame[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const mid = (bounds[i] + bounds[i + 1]) / 2
    const v = pins.reduce((acc, p, b) => acc | ((sig[p] ? levelAt(sig[p], mid) : 0) << b), 0)
    const text = hex(v, 1)
    const last = frames[frames.length - 1]
    if (last && last.text === text) last.end = bounds[i + 1]
    else frames.push({ start: bounds[i], end: bounds[i + 1], text })
  }
  return frames
}

/** Pulse width, period and frequency of a clock-like signal. */
export function pulseStats(s: DigitalSignal | undefined): { width: number; period: number } | null {
  if (!s || s.edges.length < 3) return null
  const rises = s.edges.filter((e) => levelAt(s, e) === 1)
  const falls = s.edges.filter((e) => levelAt(s, e) === 0)
  if (rises.length < 2) return null
  const period = (rises[rises.length - 1] - rises[0]) / (rises.length - 1)
  const f = falls.find((x) => x > rises[0])
  return { width: f ? f - rises[0] : NaN, period }
}
