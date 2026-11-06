// An in-memory Analog Discovery 3 behind the same DwfRaw interface as the real library, so the app
// runs without hardware (the Demo Device) and tests exercise the real wrapper. The app cannot tell
// it from a real device: everything it shows comes through the SDK calls below.
// Wavegen 1 and 2 loop back into scope channels 1 and 2, DIO pins read back what they drive, and
// sim-board.ts holds the circuit on the other pins (an RC filter, a microcontroller, I²C chips and a
// CAN node). A simulated XC7A35T sits on DIO 0–3 as JTAG (TCK, TMS, TDI, TDO), reachable by
// bit-banging or SPI.
import * as C from './generated'
import type { DwfRaw } from './generated'
import { SimTap } from './jtag-sim'
import { boardLevels, highPass } from './sim-board'

interface Wave {
  enabled: boolean
  func: number
  frequency: number
  amplitude: number
  offset: number
  symmetry: number
  phase: number
  running: boolean
}
interface SimState {
  open: boolean
  autoConfigure: number
  ain: {
    enabled: boolean[]
    range: number[]
    offset: number[]
    rate: number
    size: number
    mode: number
    trigSrc: number
    trigType: number
    trigCh: number
    trigLevel: number
    trigSlope: number
    trigPos: number
    trigAuto: number
    startedAt: number
    running: boolean
    data: Float64Array[]
  }
  aout: Wave[]
  io: { master: boolean; vPos: number; vNeg: number; enPos: boolean; enNeg: boolean }
  dio: { enable: number; output: number }
}

const SERIAL = '210415BB1C2D'
const NAME = 'Analog Discovery 3'
const HANDLE = 1
const AIN_MAX = 32768
const RATE_MAX = 125e6

export interface SimOptions {
  /** Noise added to scope samples, in volts RMS. 0 makes captures exact. */
  noise?: number
  /** Milliseconds since start; injected so tests control time. */
  now?: () => number
  /** The FPGA on DIO 0-3 (TCK, TMS, TDI, TDO); injected so tests can inspect it. */
  tap?: SimTap
}

const write = (buf: Buffer, s: string): void => {
  buf.fill(0)
  buf.write(s.slice(0, buf.length - 1), 'utf8')
}

function waveAt(w: Wave, t: number): number {
  if (!w.enabled || !w.running) return 0
  const cyc = w.frequency * t + w.phase / 360
  const p = cyc - Math.floor(cyc)
  const sym = Math.min(1, Math.max(0, w.symmetry / 100))
  let y: number
  switch (w.func) {
    case C.funcDC:
      y = 0
      break
    case C.funcSine:
      y = Math.sin(2 * Math.PI * cyc)
      break
    case C.funcSquare:
    case C.funcPulse:
      y = p < sym ? 1 : -1
      break
    case C.funcTriangle:
      y = p < sym ? -1 + (2 * p) / sym : 1 - (2 * (p - sym)) / (1 - sym)
      break
    case C.funcRampUp:
      y = 2 * p - 1
      break
    case C.funcRampDown:
      y = 1 - 2 * p
      break
    case C.funcNoise:
      y = Math.random() * 2 - 1
      break
    default:
      y = Math.sin(2 * Math.PI * cyc)
  }
  return w.offset + w.amplitude * y
}

/** Creates a simulated device. Every SDK function exists; ones it does not model fail as "not supported". */
export function createSimDwf(opts: SimOptions = {}): DwfRaw {
  const noise = opts.noise ?? 0.002
  const t0 = Date.now()
  const now = opts.now ?? (() => Date.now() - t0)
  let lastError = C.dwfercNoErc
  let lastMsg = ''
  const s: SimState = {
    open: false,
    autoConfigure: 1,
    ain: {
      enabled: [true, true],
      range: [5, 5],
      offset: [0, 0],
      rate: 100e6,
      size: 8192,
      mode: C.acqmodeSingle,
      trigSrc: C.trigsrcNone,
      trigType: C.trigtypeEdge,
      trigCh: 0,
      trigLevel: 0,
      trigSlope: C.DwfTriggerSlopeRise,
      trigPos: 0,
      trigAuto: 0,
      startedAt: 0,
      running: false,
      data: [new Float64Array(0), new Float64Array(0)]
    },
    aout: [0, 1].map(() => ({ enabled: false, func: C.funcSine, frequency: 1e3, amplitude: 1, offset: 0, symmetry: 50, phase: 0, running: false })),
    io: { master: false, vPos: 0, vNeg: 0, enPos: false, enNeg: false },
    dio: { enable: 0, output: 0 }
  }

  const fail = (erc: number, msg: string): number => {
    lastError = erc
    lastMsg = msg
    return 0
  }
  const ok = (): number => {
    lastError = C.dwfercNoErc
    lastMsg = ''
    return 1
  }
  const need = (h: number): boolean => s.open && h === HANDLE
  const badHandle = (): number => fail(C.dwfercInvalidParameter0, 'Invalid device handle')
  const chIn = (c: number): boolean => c === 0 || c === 1

  const gauss = (): number => (noise ? noise * Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * Math.cos(2 * Math.PI * Math.random()) : 0)
  // Scope 1 sees wavegen 1. Scope 2 sees wavegen 2 while it runs, otherwise wavegen 1 through the
  // board's RC high-pass. Values are noiseless; `input` adds noise and clips to the channel's range.
  const idle = (w: Wave): boolean => !w.enabled || !w.running
  const periodOf = (w: Wave): number => (!idle(w) && w.frequency > 0 ? 1 / w.frequency : 0)
  const signal = (c: number, t0: number, dt: number, n: number): Float64Array => {
    const [w1, w2] = s.aout
    if (c === 1 && idle(w2)) return highPass((t) => waveAt(w1, t), t0, dt, n, periodOf(w1))
    const d = new Float64Array(n)
    for (let i = 0; i < n; i++) d[i] = waveAt(s.aout[c], t0 + i * dt)
    return d
  }
  const clip = (c: number, v: number): number => {
    const half = s.ain.range[c] / 2
    return Math.max(s.ain.offset[c] - half, Math.min(s.ain.offset[c] + half, v + gauss()))
  }
  const input = (c: number, t: number): number => clip(c, signal(c, t, 1, 1)[0])

  const capture = (): void => {
    const a = s.ain
    const n = a.size
    const dt = 1 / a.rate
    // With an edge trigger, start the record so the crossing lands at the trigger position.
    let tStart = now() / 1000
    if (a.trigSrc === C.trigsrcDetectorAnalogIn) {
      const c = a.trigCh
      const period = periodOf(c === 1 && idle(s.aout[1]) ? s.aout[0] : s.aout[c])
      if (period) {
        const steps = 2000
        // Two periods from a whole number of periods in, so a filtered input has settled the same way.
        const base = Math.floor(tStart / period) * period
        const y = signal(c, base, period / steps, 2 * steps + 1)
        for (let k = 0; k < 2 * steps; k++) {
          const ya = y[k] - a.trigLevel
          const yb = y[k + 1] - a.trigLevel
          const rise = ya < 0 && yb >= 0
          const fall = ya > 0 && yb <= 0
          if ((a.trigSlope === C.DwfTriggerSlopeRise && rise) || (a.trigSlope === C.DwfTriggerSlopeFall && fall) || (a.trigSlope === C.DwfTriggerSlopeEither && (rise || fall))) {
            const tc = base + ((k + ya / (ya - yb)) / steps) * period
            tStart = tc + a.trigPos - (n / 2) * dt
            break
          }
        }
      }
    }
    a.data = [0, 1].map((c) => {
      if (!a.enabled[c]) return new Float64Array(n)
      const d = signal(c, tStart, dt, n)
      for (let i = 0; i < n; i++) d[i] = clip(c, d[i])
      return d
    })
  }

  // JTAG target pins and the SPI engine's wiring.
  const J = { tck: 0, tms: 1, tdi: 2, tdo: 3 }
  const tap = opts.tap ?? new SimTap()
  let lastTck = 0
  const spi = { clk: 0, mosi: 1, miso: 2, cs: 3, msb: true, selected: false }

  // Pattern generator: one entry per enabled pin, played from `started` (seconds).
  const DIG_CLOCK = 100e6
  interface PatternPin { type: number; div: number; low: number; high: number; initHigh: boolean; bits: number[] }
  const pat = { pins: new Map<number, PatternPin>(), running: false, started: 0 }
  const patPin = (c: number): PatternPin => {
    let p = pat.pins.get(c)
    if (!p) pat.pins.set(c, (p = { type: C.DwfDigitalOutTypePulse, div: 1, low: 0, high: 0, initHigh: false, bits: [] }))
    return p
  }
  const patternLevel = (p: PatternPin, t: number): number => {
    const tick = Math.floor(((t - pat.started) * DIG_CLOCK) / p.div)
    if (p.type === C.DwfDigitalOutTypeCustom) return p.bits.length ? p.bits[tick % p.bits.length] : 0
    if (p.type === C.DwfDigitalOutTypeRandom) return (Math.imul(tick ^ 0x9e3779b9, 0x85ebca6b) >>> 15) & 1
    const period = p.low + p.high
    if (!period) return p.initHigh ? 1 : 0
    // The counter starts in the init level and toggles after each run of `high` or `low` ticks.
    const first = p.initHigh ? p.high : p.low
    return (tick % period < first ? 1 : 0) ^ (p.initHigh ? 0 : 1)
  }
  /** Every pin's level at `t` seconds: static I/O outputs, then the pattern generator, then the board. */
  const pinsAt = (t: number): number => {
    let busy = s.dio.enable | (spi.selected ? (1 << spi.clk) | (1 << spi.mosi) | (1 << spi.cs) : 0)
    let driven = 0
    if (pat.running)
      for (const [c, p] of pat.pins) {
        busy |= 1 << c
        driven |= patternLevel(p, t) << c
      }
    let v = boardLevels(t, busy) & ~busy
    // The FPGA answers on TDO whenever the JTAG pins are in use.
    if (busy & 0x07 && !(busy & (1 << J.tdo))) v = (v & ~(1 << J.tdo)) | (tap.tdo << J.tdo)
    return ((v | driven | (s.dio.output & s.dio.enable)) & 0xffff) >>> 0
  }

  // Logic analyzer.
  const DIN_MAX = 16384
  const din = { div: 1, size: DIN_MAX, trigSrc: C.trigsrcNone, rise: 0, fall: 0, after: DIN_MAX, auto: 0, running: false, startedAt: 0, ready: false, data: new Uint16Array(0) }
  const digitalCapture = (): void => {
    const dt = din.div / DIG_CLOCK
    const n = din.size
    const pre = Math.max(0, n - din.after)
    const t0 = now() / 1000
    let start = 0
    din.ready = true
    if (din.trigSrc === C.trigsrcDetectorDigitalIn && (din.rise | din.fall)) {
      // Look ahead up to a millisecond (or one record) for the first matching edge.
      const limit = Math.min(2e6, Math.max(n, Math.ceil(1e-3 / dt))) + pre
      let prev = pinsAt(t0 + Math.max(0, pre - 1) * dt)
      let found = -1
      for (let i = Math.max(1, pre); i < limit; i++) {
        const v = pinsAt(t0 + i * dt)
        if ((din.rise & ~prev & v) | (din.fall & prev & ~v)) {
          found = i
          break
        }
        prev = v
      }
      if (found >= 0) start = found - pre
      // No edge: an auto timeout captures anyway; without one the analyzer keeps waiting.
      else din.ready = din.auto > 0
    }
    din.data = new Uint16Array(n)
    for (let i = 0; i < n; i++) din.data[i] = pinsAt(t0 + (start + i) * dt)
  }

  // The board's microcontroller echoes UART bytes; its I²C chips and CAN node answer as sim-board.ts says.
  const uart = { rx: [] as number[] }
  const eeprom = new Uint8Array(256).fill(0xff)
  let eepromAt = 0
  let tmpReg = 0
  const i2c = (adr8: number, tx: Uint8Array, ntx: number, rx: Uint8Array | null, nrx: number): number => {
    const a = adr8 >> 1
    if (a === 0x50) {
      if (ntx > 0) {
        eepromAt = tx[0]
        for (let i = 1; i < ntx; i++) eeprom[(eepromAt + i - 1) & 0xff] = tx[i]
        if (ntx > 1) eepromAt = (eepromAt + ntx - 1) & 0xff
      }
      for (let i = 0; i < nrx && rx; i++) rx[i] = eeprom[(eepromAt + i) & 0xff]
      eepromAt = (eepromAt + nrx) & 0xff
      return 0
    }
    if (a === 0x48) {
      if (ntx > 0) tmpReg = tx[0] & 3
      // Temperature 23.5 °C plus a little wander, 12-bit, 0.0625 °C per count.
      const raw = Math.round((23.5 + Math.sin(now() / 7000) * 0.4) / 0.0625) << 4
      const regs = [raw, 0x60a0, 0x4b00, 0x5000]
      const v = regs[tmpReg]
      for (let i = 0; i < nrx && rx; i++) rx[i] = i % 2 ? v & 0xff : v >> 8
      return 0
    }
    // Nobody answered the address byte.
    return 1
  }
  const can = { rx: [] as { id: number; ext: number; rem: number; data: number[] }[] }

  const impl: Partial<Record<keyof DwfRaw, (...args: never[]) => number>> = {
    FDwfGetLastError: (p: Int32Array) => ((p[0] = lastError), 1),
    FDwfGetLastErrorMsg: (b: Buffer) => (write(b, lastMsg), 1),
    FDwfGetVersion: (b: Buffer) => (write(b, '3.24.2 (simulated)'), ok()),

    FDwfEnum: (_f: number, p: Int32Array) => ((p[0] = 1), ok()),
    FDwfEnumDeviceName: (i: number, b: Buffer) => (i === 0 ? (write(b, NAME), ok()) : fail(C.dwfercInvalidParameter0, 'No such device')),
    FDwfEnumSN: (i: number, b: Buffer) => (i === 0 ? (write(b, 'SN:' + SERIAL), ok()) : fail(C.dwfercInvalidParameter0, 'No such device')),
    FDwfEnumUserName: (i: number, b: Buffer) => (i === 0 ? (write(b, ''), ok()) : fail(C.dwfercInvalidParameter0, 'No such device')),
    FDwfEnumDeviceType: (i: number, id: Int32Array, rev: Int32Array) => (i === 0 ? ((id[0] = C.devidDiscovery3), (rev[0] = 1), ok()) : fail(C.dwfercInvalidParameter0, 'No such device')),
    FDwfEnumDeviceIsOpened: (i: number, p: Int32Array) => ((p[0] = s.open ? 1 : 0), i === 0 ? ok() : fail(C.dwfercInvalidParameter0, 'No such device')),
    FDwfEnumConfig: (_i: number, p: Int32Array) => ((p[0] = 4), ok()),
    FDwfEnumConfigInfo: (cfg: number, info: number, p: Int32Array) => {
      // The AD3's four buffer configurations, as WaveForms lists them.
      const table: Record<number, number[]> = {
        [C.DECIAnalogInChannelCount]: [2, 2, 2, 2],
        [C.DECIAnalogOutChannelCount]: [2, 2, 2, 2],
        [C.DECIAnalogIOChannelCount]: [3, 3, 3, 3],
        [C.DECIDigitalIOChannelCount]: [16, 16, 16, 16],
        [C.DECIAnalogInBufferSize]: [32768, 16384, 1024, 1024],
        [C.DECIAnalogOutBufferSize]: [16384, 16384, 1024, 1024],
        [C.DECIDigitalInBufferSize]: [16384, 32768, 65536, 4096],
        [C.DECIDigitalOutBufferSize]: [16384, 16384, 16384, 32768]
      }
      p[0] = table[info]?.[cfg] ?? 0
      return ok()
    },

    FDwfDeviceOpen: (i: number, h: Int32Array) => {
      if (i !== 0 && i !== -1) return (h[0] = C.hdwfNone), fail(C.dwfercInvalidParameter0, 'No such device')
      if (s.open) return (h[0] = C.hdwfNone), fail(C.dwfercAlreadyOpened, 'Device already opened')
      s.open = true
      h[0] = HANDLE
      return ok()
    },
    FDwfDeviceConfigOpen: (i: number, _cfg: number, h: Int32Array) => (impl.FDwfDeviceOpen as (i: number, h: Int32Array) => number)(i, h),
    FDwfDeviceClose: (h: number) => (need(h) ? ((s.open = false), ok()) : badHandle()),
    FDwfDeviceCloseAll: () => ((s.open = false), ok()),
    FDwfDeviceAutoConfigureSet: (h: number, v: number) => (need(h) ? ((s.autoConfigure = v), ok()) : badHandle()),
    FDwfDeviceReset: (h: number) => {
      if (!need(h)) return badHandle()
      s.aout.forEach((w) => Object.assign(w, { enabled: false, running: false }))
      s.dio = { enable: 0, output: 0 }
      Object.assign(s.io, { master: false, enPos: false, enNeg: false })
      return ok()
    },

    // Scope
    FDwfAnalogInChannelCount: (h: number, p: Int32Array) => (need(h) ? ((p[0] = 2), ok()) : badHandle()),
    FDwfAnalogInChannelEnableSet: (h: number, c: number, v: number) => (!need(h) ? badHandle() : chIn(c) ? ((s.ain.enabled[c] = !!v), ok()) : fail(C.dwfercInvalidParameter1, 'Invalid channel')),
    FDwfAnalogInChannelRangeSet: (h: number, c: number, v: number) =>
      !need(h) ? badHandle() : chIn(c) ? ((s.ain.range[c] = v > 5 ? 50 : 5), ok()) : fail(C.dwfercInvalidParameter1, 'Invalid channel'),
    // Sample modes are accepted; the simulator's samples are exact.
    FDwfAnalogInChannelFilterSet: (h: number, c: number) => (!need(h) ? badHandle() : chIn(c) ? ok() : fail(C.dwfercInvalidParameter1, 'Invalid channel')),
    FDwfAnalogInChannelOffsetSet: (h: number, c: number, v: number) => (!need(h) ? badHandle() : chIn(c) ? ((s.ain.offset[c] = v), ok()) : fail(C.dwfercInvalidParameter1, 'Invalid channel')),
    FDwfAnalogInAcquisitionModeSet: (h: number, m: number) => (need(h) ? ((s.ain.mode = m), ok()) : badHandle()),
    FDwfAnalogInFrequencySet: (h: number, hz: number) => (need(h) ? ((s.ain.rate = RATE_MAX / Math.max(1, Math.round(RATE_MAX / Math.min(RATE_MAX, Math.max(1, hz))))), ok()) : badHandle()),
    FDwfAnalogInFrequencyGet: (h: number, p: Float64Array) => (need(h) ? ((p[0] = s.ain.rate), ok()) : badHandle()),
    FDwfAnalogInBufferSizeInfo: (h: number, a: Int32Array, b: Int32Array) => (need(h) ? ((a[0] = 16), (b[0] = AIN_MAX), ok()) : badHandle()),
    FDwfAnalogInBufferSizeSet: (h: number, n: number) => (need(h) ? ((s.ain.size = Math.max(16, Math.min(AIN_MAX, n | 0))), ok()) : badHandle()),
    FDwfAnalogInTriggerSourceSet: (h: number, v: number) => (need(h) ? ((s.ain.trigSrc = v), ok()) : badHandle()),
    FDwfAnalogInTriggerTypeSet: (h: number, v: number) => (need(h) ? ((s.ain.trigType = v), ok()) : badHandle()),
    FDwfAnalogInTriggerChannelSet: (h: number, c: number) => (!need(h) ? badHandle() : chIn(c) ? ((s.ain.trigCh = c), ok()) : fail(C.dwfercInvalidParameter1, 'Invalid channel')),
    FDwfAnalogInTriggerLevelSet: (h: number, v: number) => (need(h) ? ((s.ain.trigLevel = v), ok()) : badHandle()),
    FDwfAnalogInTriggerConditionSet: (h: number, v: number) => (need(h) ? ((s.ain.trigSlope = v), ok()) : badHandle()),
    FDwfAnalogInTriggerPositionSet: (h: number, v: number) => (need(h) ? ((s.ain.trigPos = v), ok()) : badHandle()),
    // Holdoff, hysteresis, filter and pulse lengths are accepted; the simulator triggers on edges.
    FDwfAnalogInTriggerHoldOffSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfAnalogInTriggerHysteresisSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfAnalogInTriggerFilterSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfAnalogInTriggerLengthConditionSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfAnalogInTriggerLengthSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfAnalogInTriggerAutoTimeoutSet: (h: number, v: number) => (need(h) ? ((s.ain.trigAuto = v), ok()) : badHandle()),
    FDwfAnalogInConfigure: (h: number, _re: number, start: number) => {
      if (!need(h)) return badHandle()
      s.ain.running = !!start
      if (start) {
        s.ain.startedAt = now()
        capture()
      }
      return ok()
    },
    FDwfAnalogInStatus: (h: number, _read: number, sts: Uint8Array) => {
      if (!need(h)) return badHandle()
      // Done once the record's own duration has passed, so slow sample rates take real time.
      const ms = (s.ain.size / s.ain.rate) * 1000
      sts[0] = s.ain.running ? (now() - s.ain.startedAt >= ms ? C.DwfStateDone : C.DwfStateTriggered) : C.DwfStateReady
      if (sts[0] === C.DwfStateDone) s.ain.running = false
      return ok()
    },
    FDwfAnalogInStatusData: (h: number, c: number, out: Float64Array, n: number) => {
      if (!need(h)) return badHandle()
      if (!chIn(c)) return fail(C.dwfercInvalidParameter1, 'Invalid channel')
      out.set(s.ain.data[c].subarray(0, Math.min(n, out.length)))
      return ok()
    },
    FDwfAnalogInStatusSample: (h: number, c: number, p: Float64Array) => (!need(h) ? badHandle() : chIn(c) ? ((p[0] = input(c, now() / 1000)), ok()) : fail(C.dwfercInvalidParameter1, 'Invalid channel')),

    // Wavegen
    FDwfAnalogOutCount: (h: number, p: Int32Array) => (need(h) ? ((p[0] = 2), ok()) : badHandle()),
    FDwfAnalogOutNodeEnableSet: (h: number, c: number, node: number, v: number) => nodeSet(h, c, node, (w) => (w.enabled = !!v)),
    FDwfAnalogOutNodeFunctionSet: (h: number, c: number, node: number, v: number) => nodeSet(h, c, node, (w) => (w.func = v)),
    FDwfAnalogOutNodeFrequencySet: (h: number, c: number, node: number, v: number) => nodeSet(h, c, node, (w) => (w.frequency = Math.max(0, Math.min(50e6, v)))),
    FDwfAnalogOutNodeAmplitudeSet: (h: number, c: number, node: number, v: number) => nodeSet(h, c, node, (w) => (w.amplitude = Math.max(-5, Math.min(5, v)))),
    FDwfAnalogOutNodeOffsetSet: (h: number, c: number, node: number, v: number) => nodeSet(h, c, node, (w) => (w.offset = Math.max(-5, Math.min(5, v)))),
    FDwfAnalogOutNodeSymmetrySet: (h: number, c: number, node: number, v: number) => nodeSet(h, c, node, (w) => (w.symmetry = Math.max(0, Math.min(100, v)))),
    FDwfAnalogOutNodePhaseSet: (h: number, c: number, node: number, v: number) => nodeSet(h, c, node, (w) => (w.phase = ((v % 360) + 360) % 360)),
    FDwfAnalogOutConfigure: (h: number, c: number, start: number) => {
      if (!need(h)) return badHandle()
      const ws = c === -1 ? s.aout : s.aout[c] ? [s.aout[c]] : null
      if (!ws) return fail(C.dwfercInvalidParameter1, 'Invalid channel')
      ws.forEach((w) => (w.running = !!start))
      return ok()
    },
    FDwfAnalogOutStatus: (h: number, c: number, p: Uint8Array) => (!need(h) ? badHandle() : s.aout[c] ? ((p[0] = s.aout[c].running ? C.DwfStateRunning : C.DwfStateReady), ok()) : fail(C.dwfercInvalidParameter1, 'Invalid channel')),

    // Supplies and monitors: 0 V+, 1 V−, 2 USB/system.
    FDwfAnalogIOChannelCount: (h: number, p: Int32Array) => (need(h) ? ((p[0] = 3), ok()) : badHandle()),
    FDwfAnalogIOChannelName: (h: number, c: number, name: Buffer, label: Buffer) => {
      if (!need(h)) return badHandle()
      const n = [
        ['Positive Supply', 'V+'],
        ['Negative Supply', 'V-'],
        ['USB Monitor', 'USB']
      ][c]
      if (!n) return fail(C.dwfercInvalidParameter1, 'Invalid channel')
      write(name, n[0])
      write(label, n[1])
      return ok()
    },
    FDwfAnalogIOChannelInfo: (h: number, c: number, p: Int32Array) => (!need(h) ? badHandle() : c >= 0 && c < 3 ? ((p[0] = 3), ok()) : fail(C.dwfercInvalidParameter1, 'Invalid channel')),
    FDwfAnalogIOChannelNodeName: (h: number, c: number, k: number, name: Buffer, units: Buffer) => {
      if (!need(h)) return badHandle()
      const n = (c < 2 ? [['Enable', ''], ['Voltage', 'V'], ['Current', 'A']] : [['Voltage', 'V'], ['Current', 'A'], ['Temperature', 'degC']])[k]
      if (!n || c < 0 || c > 2) return fail(C.dwfercInvalidParameter2, 'Invalid node')
      write(name, n[0])
      write(units, n[1])
      return ok()
    },
    FDwfAnalogIOChannelNodeInfo: (h: number, c: number, k: number, p: Uint8Array) => {
      if (!need(h)) return badHandle()
      p[0] = (c < 2 ? [C.analogioEnable, C.analogioVoltage, C.analogioCurrent] : [C.analogioVoltage, C.analogioCurrent, C.analogioTemperature])[k] ?? 0
      return ok()
    },
    FDwfAnalogIOChannelNodeSet: (h: number, c: number, k: number, v: number) => {
      if (!need(h)) return badHandle()
      if (c === 0 && k === 0) s.io.enPos = !!v
      else if (c === 1 && k === 0) s.io.enNeg = !!v
      else if (c === 0 && k === 1) s.io.vPos = Math.max(0.5, Math.min(5, v))
      else if (c === 1 && k === 1) s.io.vNeg = Math.max(-5, Math.min(-0.5, v))
      else return fail(C.dwfercInvalidParameter2, 'Node is read-only')
      return ok()
    },
    FDwfAnalogIOEnableSet: (h: number, v: number) => (need(h) ? ((s.io.master = !!v), ok()) : badHandle()),
    FDwfAnalogIOConfigure: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfAnalogIOStatus: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfAnalogIOChannelNodeStatus: (h: number, c: number, k: number, p: Float64Array) => {
      if (!need(h)) return badHandle()
      const on = (en: boolean): boolean => s.io.master && en
      const pos = on(s.io.enPos) ? s.io.vPos : 0
      const neg = on(s.io.enNeg) ? s.io.vNeg : 0
      // A 1 kΩ load on each rail; USB current covers the board plus both rails.
      const table = [
        [on(s.io.enPos) ? 1 : 0, pos, pos / 1000],
        [on(s.io.enNeg) ? 1 : 0, neg, neg / 1000],
        [5.02, 0.32 + Math.abs(pos) / 1000 + Math.abs(neg) / 1000, 41.5]
      ]
      const v = table[c]?.[k]
      if (v === undefined) return fail(C.dwfercInvalidParameter2, 'Invalid node')
      p[0] = v + (k > 0 ? gauss() * 0.1 : 0)
      return ok()
    },

    // Static I/O: 16 pins.
    FDwfDigitalIOOutputEnableInfo: (h: number, p: Uint32Array) => (need(h) ? ((p[0] = 0xffff), ok()) : badHandle()),
    FDwfDigitalIOOutputEnableSet: (h: number, v: number) => (need(h) ? ((s.dio.enable = v & 0xffff), ok()) : badHandle()),
    FDwfDigitalIOOutputSet: (h: number, v: number) => (need(h) ? ((s.dio.output = v & 0xffff), ok()) : badHandle()),
    FDwfDigitalIOConfigure: (h: number) => {
      if (!need(h)) return badHandle()
      const lv = (p: number) => (s.dio.output & s.dio.enable) >> p & 1
      const tck = lv(J.tck)
      if (tck && !lastTck && !spi.selected) tap.clock(lv(J.tms), lv(J.tdi))
      lastTck = tck
      return ok()
    },
    FDwfDigitalIOStatus: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalIOInputStatus: (h: number, p: Uint32Array) => (need(h) ? ((p[0] = pinsAt(now() / 1000)), ok()) : badHandle()),

    // Logic analyzer: records the pins at the divided 100 MHz clock, triggered on pin edges.
    FDwfDigitalInInternalClockInfo: (h: number, p: Float64Array) => (need(h) ? ((p[0] = DIG_CLOCK), ok()) : badHandle()),
    FDwfDigitalInBufferSizeInfo: (h: number, p: Int32Array) => (need(h) ? ((p[0] = DIN_MAX), ok()) : badHandle()),
    FDwfDigitalInAcquisitionModeSet: (h: number, m: number) => (!need(h) ? badHandle() : m === C.acqmodeSingle ? ok() : fail(C.dwfercNotSupported, 'Only single captures are simulated')),
    FDwfDigitalInDividerSet: (h: number, v: number) => (need(h) ? ((din.div = Math.max(1, v | 0)), ok()) : badHandle()),
    FDwfDigitalInSampleFormatSet: (h: number, v: number) => (!need(h) ? badHandle() : v === 16 ? ok() : fail(C.dwfercNotSupported, 'Only 16-bit samples are simulated')),
    FDwfDigitalInBufferSizeSet: (h: number, v: number) => (need(h) ? ((din.size = Math.max(16, Math.min(DIN_MAX, v | 0))), ok()) : badHandle()),
    FDwfDigitalInTriggerSourceSet: (h: number, v: number) => (need(h) ? ((din.trigSrc = v), ok()) : badHandle()),
    FDwfDigitalInTriggerSet: (h: number, _low: number, _high: number, rise: number, fall: number) => (need(h) ? ((din.rise = rise & 0xffff), (din.fall = fall & 0xffff), ok()) : badHandle()),
    FDwfDigitalInTriggerPositionSet: (h: number, v: number) => (need(h) ? ((din.after = Math.max(0, v | 0)), ok()) : badHandle()),
    FDwfDigitalInTriggerAutoTimeoutSet: (h: number, v: number) => (need(h) ? ((din.auto = v), ok()) : badHandle()),
    FDwfDigitalInConfigure: (h: number, _re: number, start: number) => {
      if (!need(h)) return badHandle()
      din.running = !!start
      if (start) {
        din.startedAt = now()
        digitalCapture()
      }
      return ok()
    },
    FDwfDigitalInStatus: (h: number, _read: number, sts: Uint8Array) => {
      if (!need(h)) return badHandle()
      const ms = ((din.size * din.div) / DIG_CLOCK) * 1000
      sts[0] = !din.running ? C.DwfStateReady : !din.ready ? C.DwfStateArmed : now() - din.startedAt >= ms ? C.DwfStateDone : C.DwfStateTriggered
      if (sts[0] === C.DwfStateDone) din.running = false
      return ok()
    },
    FDwfDigitalInStatusData: (h: number, out: ArrayBufferView, bytes: number) => {
      if (!need(h)) return badHandle()
      const dst = new Uint16Array(out.buffer, out.byteOffset, Math.min(bytes, out.byteLength) >> 1)
      dst.set(din.data.subarray(0, dst.length))
      return ok()
    },

    // Pattern generator.
    FDwfDigitalOutInternalClockInfo: (h: number, p: Float64Array) => (need(h) ? ((p[0] = DIG_CLOCK), ok()) : badHandle()),
    FDwfDigitalOutReset: (h: number) => (need(h) ? (pat.pins.clear(), (pat.running = false), ok()) : badHandle()),
    FDwfDigitalOutEnableSet: (h: number, c: number, v: number) => (!need(h) ? badHandle() : c < 0 || c > 15 ? fail(C.dwfercInvalidParameter1, 'Invalid channel') : (v ? patPin(c) : pat.pins.delete(c), ok())),
    FDwfDigitalOutIdleSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalOutTypeSet: (h: number, c: number, v: number) => (need(h) ? ((patPin(c).type = v), ok()) : badHandle()),
    FDwfDigitalOutDividerSet: (h: number, c: number, v: number) => (need(h) ? ((patPin(c).div = Math.max(1, v | 0)), ok()) : badHandle()),
    FDwfDigitalOutCounterSet: (h: number, c: number, low: number, high: number) => (need(h) ? (Object.assign(patPin(c), { low, high }), ok()) : badHandle()),
    FDwfDigitalOutCounterInitSet: (h: number, c: number, high: number) => (need(h) ? ((patPin(c).initHigh = !!high), ok()) : badHandle()),
    FDwfDigitalOutDataSet: (h: number, c: number, data: Uint8Array, n: number) => (need(h) ? ((patPin(c).bits = Array.from({ length: n }, (_, i) => (data[i >> 3] >> (i & 7)) & 1)), ok()) : badHandle()),
    FDwfDigitalOutRepeatSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalOutConfigure: (h: number, start: number) => (need(h) ? ((pat.running = !!start), (pat.started = now() / 1000), ok()) : badHandle()),

    // UART master: the microcontroller echoes every byte back.
    FDwfDigitalUartReset: (h: number) => (need(h) ? ((uart.rx = []), ok()) : badHandle()),
    FDwfDigitalUartRateSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalUartBitsSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalUartParitySet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalUartStopSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalUartTxSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalUartRxSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalUartTx: (h: number, b: Buffer, n: number) => (need(h) ? (uart.rx.push(...b.subarray(0, n)), ok()) : badHandle()),
    FDwfDigitalUartRx: (h: number, b: Buffer, max: number, got: Int32Array, parity: Int32Array) => {
      if (!need(h)) return badHandle()
      const take = uart.rx.splice(0, Math.max(0, max))
      b.set(take)
      got[0] = take.length
      parity[0] = 0
      return ok()
    },

    // I²C master.
    FDwfDigitalI2cReset: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalI2cStretchSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalI2cRateSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalI2cSclSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalI2cSdaSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalI2cClear: (h: number, free: Int32Array) => (need(h) ? ((free[0] = 1), ok()) : badHandle()),
    FDwfDigitalI2cWriteRead: (h: number, a: number, tx: Uint8Array, ntx: number, rx: Uint8Array, nrx: number, nak: Int32Array) => (need(h) ? ((nak[0] = i2c(a, tx, ntx, rx, nrx)), ok()) : badHandle()),
    FDwfDigitalI2cRead: (h: number, a: number, rx: Uint8Array, nrx: number, nak: Int32Array) => (need(h) ? ((nak[0] = i2c(a, new Uint8Array(0), 0, rx, nrx)), ok()) : badHandle()),
    FDwfDigitalI2cWrite: (h: number, a: number, tx: Uint8Array, ntx: number, nak: Int32Array) => (need(h) ? ((nak[0] = i2c(a, tx, ntx, null, 0)), ok()) : badHandle()),

    // CAN: the board's node answers each frame on the next ID.
    FDwfDigitalCanReset: (h: number) => (need(h) ? ((can.rx = []), ok()) : badHandle()),
    FDwfDigitalCanRateSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalCanPolaritySet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalCanTxSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalCanRxSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalCanTx: (h: number, id: number, ext: number, rem: number, dlc: number, data: Uint8Array) => {
      if (!need(h)) return badHandle()
      if (id >= 0) can.rx.push({ id: (id + 1) & (ext ? 0x1fffffff : 0x7ff), ext, rem: 0, data: rem ? [0xde, 0xad] : [...data.subarray(0, dlc)] })
      return ok()
    },
    FDwfDigitalCanRx: (h: number, id: Int32Array, ext: Int32Array, rem: Int32Array, dlc: Int32Array, data: Uint8Array, _n: number, st: Int32Array) => {
      if (!need(h)) return badHandle()
      const f = can.rx.shift()
      st[0] = f ? 1 : 0
      if (f) {
        id[0] = f.id
        ext[0] = f.ext
        rem[0] = f.rem
        dlc[0] = f.data.length
        data.set(f.data.slice(0, data.length))
      }
      return ok()
    },

    // SPI master: clocks the simulated JTAG target when its pins are TCK, TDI, TDO and TMS (select).
    FDwfDigitalSpiReset: (h: number) => (need(h) ? ((spi.selected = false), ok()) : badHandle()),
    FDwfDigitalSpiFrequencySet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalSpiClockSet: (h: number, c: number) => (need(h) ? ((spi.clk = c), ok()) : badHandle()),
    FDwfDigitalSpiDataSet: (h: number, dq: number, c: number) => (need(h) ? (dq === 0 ? (spi.mosi = c) : (spi.miso = c), ok()) : badHandle()),
    FDwfDigitalSpiModeSet: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalSpiOrderSet: (h: number, msb: number) => (need(h) ? ((spi.msb = !!msb), ok()) : badHandle()),
    FDwfDigitalSpiSelectSet: (h: number, c: number) => (need(h) ? ((spi.cs = c), ok()) : badHandle()),
    FDwfDigitalSpiSelect: (h: number, c: number, level: number) => (need(h) ? (c === spi.cs && (spi.selected = level === 0), ok()) : badHandle()),
    FDwfDigitalSpiWrite: (h: number, _dq: number, bits: number, tx: Uint8Array, n: number) => (need(h) ? (spiShift(bits, tx, n), ok()) : badHandle()),
    FDwfDigitalSpiWriteRead: (h: number, _dq: number, bits: number, tx: Uint8Array, n: number, rx: Uint8Array, nr: number) => {
      if (!need(h)) return badHandle()
      const r = spiShift(bits, tx, n)
      for (let i = 0; i < nr; i++) rx[i] = r[i] ?? 0
      return ok()
    }
  }

  /** Shifts words out of MOSI; returns what MISO read. */
  function spiShift(bits: number, tx: Uint8Array, n: number): number[] {
    const wired = spi.clk === J.tck && spi.mosi === J.tdi
    const tms = spi.cs === J.tms ? (spi.selected ? 0 : 1) : (s.dio.output & s.dio.enable) >> J.tms & 1
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let k = 0; k < bits; k++) {
        const b = spi.msb ? bits - 1 - k : k
        const tdi = (tx[i] >> b) & 1
        const tdo = spi.miso === J.tdo ? tap.tdo : 0
        if (wired) tap.clock(tms, tdi)
        r |= tdo << b
      }
      out.push(r)
    }
    return out
  }

  function nodeSet(h: number, c: number, node: number, f: (w: Wave) => void): number {
    if (!need(h)) return badHandle()
    if (!s.aout[c]) return fail(C.dwfercInvalidParameter1, 'Invalid channel')
    // The simulator models the carrier only; AM and FM settings are accepted and ignored.
    if (node !== C.AnalogOutNodeCarrier) return ok()
    f(s.aout[c])
    return ok()
  }

  return new Proxy(impl, {
    get(target, name: string) {
      const fn = target[name as keyof DwfRaw]
      if (fn) return fn
      return () => fail(C.dwfercNotSupported, `${name} is not supported by the simulated device`)
    }
  }) as unknown as DwfRaw
}
