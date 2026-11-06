// An in-memory Analog Discovery 3 behind the same DwfRaw interface as the real library, so the app
// runs without hardware and tests exercise the real wrapper. Wavegen 1 and 2 loop back into scope
// channels 1 and 2; DIO pins read back what they drive, and undriven pins read a slow counter.
import * as C from './generated'
import type { DwfRaw } from './generated'

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
  // Scope input c sees wavegen c, clipped to the channel's range around its offset.
  const input = (c: number, t: number): number => {
    const v = waveAt(s.aout[c], t) + gauss()
    const half = s.ain.range[c] / 2
    return Math.max(s.ain.offset[c] - half, Math.min(s.ain.offset[c] + half, v))
  }

  const capture = (): void => {
    const a = s.ain
    const n = a.size
    const dt = 1 / a.rate
    // With an edge trigger, start the record so the crossing lands at the trigger position.
    let tStart = now() / 1000
    if (a.trigSrc === C.trigsrcDetectorAnalogIn) {
      const w = s.aout[a.trigCh]
      const period = w.running && w.enabled && w.frequency > 0 ? 1 / w.frequency : 0
      if (period) {
        const steps = 2000
        const f = (t: number): number => waveAt(w, t) - a.trigLevel
        for (let k = 0; k < steps; k++) {
          const ta = (k / steps) * period
          const tb = ((k + 1) / steps) * period
          const ya = f(ta)
          const yb = f(tb)
          const rise = ya < 0 && yb >= 0
          const fall = ya > 0 && yb <= 0
          if ((a.trigSlope === C.DwfTriggerSlopeRise && rise) || (a.trigSlope === C.DwfTriggerSlopeFall && fall) || (a.trigSlope === C.DwfTriggerSlopeEither && (rise || fall))) {
            const tc = ta + (tb - ta) * (ya / (ya - yb))
            tStart = tc + a.trigPos - (n / 2) * dt
            break
          }
        }
      }
    }
    a.data = [0, 1].map((c) => {
      const d = new Float64Array(n)
      if (a.enabled[c]) for (let i = 0; i < n; i++) d[i] = input(c, tStart + i * dt)
      return d
    })
  }

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
    FDwfDigitalIOConfigure: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalIOStatus: (h: number) => (need(h) ? ok() : badHandle()),
    FDwfDigitalIOInputStatus: (h: number, p: Uint32Array) => {
      if (!need(h)) return badHandle()
      const counter = Math.floor(now() / 1000) & 0xffff
      p[0] = ((s.dio.output & s.dio.enable) | (counter & ~s.dio.enable)) & 0xffff
      return ok()
    }
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
