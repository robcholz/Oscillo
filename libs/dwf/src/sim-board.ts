// What is wired to the simulated device's pins, so every instrument has something real to measure.
//
//   Analog: a 100 nF capacitor from scope 1 to scope 2 and 1 kΩ from scope 2 to ground. While wavegen 2
//           is idle, scope 2 sees wavegen 1 through that RC high-pass (corner 1.59 kHz); the Network
//           Analyzer shows the filter and the Impedance Analyzer (1 kΩ reference) shows the capacitor.
//   DIO 0–3: SPI (SCK, MOSI, MISO, CS) from a small microcontroller, a 4-byte transfer every 200 µs.
//            The XC7A35T JTAG target (TCK, TMS, TDI, TDO) shares these pins: the microcontroller lets
//            go of them while the device drives any of them.
//   DIO 4–5: the microcontroller's UART (TX, RX) at 250 kBd, "AT" and "OK\r" every 200 µs.
//   DIO 6–15: a binary seconds counter.
//   UART master: the microcontroller echoes what it receives.
//   I²C: a TMP102 temperature sensor at 0x48 and a 24C02 EEPROM at 0x50.
//   CAN: one node that answers each frame on the next ID with the same data.

export const RC = 100e-9 * 1e3

export const PINS = { sck: 0, mosi: 1, miso: 2, cs: 3, tx: 4, rx: 5, counter: 6 }
const FRAME = 200e-6
const SPI_T = 5e-6
const SPI_AT = 2.4e-6
const BAUD_T = 4e-6
export const SPI_MOSI = [0xa5, 0x3c, 0xf0, 0x0f]
/** What the microcontroller answers in SPI frame k. */
export const spiMiso = (k: number): number[] => [0xff, 0x00, k & 0xff, (k * 37) & 0xff]
const TX = [
  { c: 0x41, at: 6e-6 },
  { c: 0x54, at: 100e-6 }
]
const RX = [
  { c: 0x4f, at: 19.6e-6 },
  { c: 0x4b, at: 67.1e-6 },
  { c: 0x0d, at: 115e-6 }
]

function uartAt(chars: { c: number; at: number }[], u: number): number {
  for (const { c, at } of chars) {
    const b = Math.floor((u - at) / BAUD_T)
    if (b < 0 || b > 9) continue
    return b === 0 ? 0 : b === 9 ? 1 : (c >> (b - 1)) & 1
  }
  return 1
}

/**
 * The levels the board drives at time `t` (seconds), as a 16-bit word. `busy` holds the pins the
 * device itself drives; the microcontroller releases its SPI or UART pins when any of them is busy.
 */
export function boardLevels(t: number, busy: number): number {
  let v = (Math.floor(t) << PINS.counter) & 0xffc0
  const k = Math.floor(t / FRAME)
  const u = t - k * FRAME
  if (!(busy & 0x0f)) {
    const i = Math.floor((u - SPI_AT) / SPI_T)
    const inBit = i >= 0 && i < 32
    const cs = u >= SPI_AT - 0.4e-6 && u < SPI_AT + 32 * SPI_T + 0.4e-6 ? 0 : 1
    if (inBit) {
      const bit = 7 - (i % 8)
      const byte = i >> 3
      const sck = u - SPI_AT - i * SPI_T >= SPI_T / 2 ? 1 : 0
      v |= sck << PINS.sck
      v |= ((SPI_MOSI[byte] >> bit) & 1) << PINS.mosi
      v |= ((spiMiso(k)[byte] >> bit) & 1) << PINS.miso
    }
    v |= cs << PINS.cs
  }
  if (!(busy & 0x30)) v |= (uartAt(TX, u) << PINS.tx) | (uartAt(RX, u) << PINS.rx)
  return v & 0xffff
}

/**
 * Scope 2's input over a record: wavegen 1 (`v1`) through the RC high-pass. Integrates from 5 RC
 * before the record so the capacitor has settled, in steps short enough for both RC and the signal.
 */
export function highPass(v1: (t: number) => number, t0: number, dt: number, n: number, period: number): Float64Array {
  const out = new Float64Array(n)
  let h = Math.min(dt, RC / 20, period > 0 ? period / 40 : Infinity)
  // Keep the work bounded for very long records; the capacitor then follows a coarser input.
  const budget = 4e6
  if ((n * dt + 5 * RC) / h > budget) h = (n * dt + 5 * RC) / budget
  let t = t0 - 5 * RC
  let vc = v1(t)
  let prev = vc
  for (let i = 0; i < n; i++) {
    const ti = t0 + i * dt
    while (t < ti) {
      const step = Math.min(h, ti - t)
      const a = Math.exp(-step / RC)
      const next = v1(t + step)
      // Exact for an input that is linear across the step: vc' = (v1 − vc) / RC.
      const mRC = ((next - prev) / step) * RC
      vc = next - mRC + (vc - prev + mRC) * a
      prev = next
      t += step
    }
    out[i] = prev - vc
  }
  return out
}
