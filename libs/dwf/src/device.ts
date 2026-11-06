// The typed API over DwfRaw: enumerate and open devices, then drive the scope, wavegen, supplies and
// static I/O. Every SDK call is checked; a failure throws DwfError with the SDK's own message.
import * as C from './generated'
import type { DwfRaw } from './generated'
import { BitBang, LogicIn, PatternOut, Protocols } from './digital'

export class DwfError extends Error {
  constructor(
    readonly fn: string,
    readonly code: number,
    message: string
  ) {
    super(`${fn}: ${message || 'failed'}`)
    this.name = 'DwfError'
  }
}

const str = (b: Buffer): string => b.toString('utf8', 0, Math.max(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)))

/** Calls one SDK function and throws if it returns 0. */
export function call<K extends keyof DwfRaw>(raw: DwfRaw, fn: K, ...args: Parameters<DwfRaw[K]>): void {
  const ok = (raw[fn] as (...a: unknown[]) => number)(...args)
  if (ok) return
  const code = new Int32Array(1)
  const msg = Buffer.alloc(512)
  raw.FDwfGetLastError(code)
  raw.FDwfGetLastErrorMsg(msg)
  throw new DwfError(String(fn), code[0], str(msg).trim())
}

const int = (raw: DwfRaw, fn: keyof DwfRaw, ...args: unknown[]): number => {
  const out = new Int32Array(1)
  ;(call as (...a: unknown[]) => void)(raw, fn, ...args, out)
  return out[0]
}
export const dbl = (raw: DwfRaw, fn: keyof DwfRaw, ...args: unknown[]): number => {
  const out = new Float64Array(1)
  ;(call as (...a: unknown[]) => void)(raw, fn, ...args, out)
  return out[0]
}

export interface DeviceInfo {
  index: number
  name: string
  serial: string
  userName: string
  id: number
  revision: number
  opened: boolean
  /** Buffer configurations the device offers (Device Options › Configuration). */
  configs: DeviceConfig[]
}

export interface DeviceConfig {
  index: number
  analogInChannels: number
  analogOutChannels: number
  analogIOChannels: number
  digitalIOChannels: number
  analogInBuffer: number
  analogOutBuffer: number
  digitalInBuffer: number
  digitalOutBuffer: number
}

export class Dwf {
  constructor(readonly raw: DwfRaw) {}

  version(): string {
    const b = Buffer.alloc(32)
    call(this.raw, 'FDwfGetVersion', b)
    return str(b)
  }

  /** Every connected device, with its buffer configurations. */
  devices(filter = C.enumfilterAll): DeviceInfo[] {
    const r = this.raw
    const n = int(r, 'FDwfEnum', filter)
    return Array.from({ length: n }, (_, i) => {
      const name = Buffer.alloc(32)
      const sn = Buffer.alloc(32)
      const user = Buffer.alloc(32)
      call(r, 'FDwfEnumDeviceName', i, name)
      call(r, 'FDwfEnumSN', i, sn)
      call(r, 'FDwfEnumUserName', i, user)
      const id = new Int32Array(1)
      const rev = new Int32Array(1)
      call(r, 'FDwfEnumDeviceType', i, id, rev)
      const nCfg = int(r, 'FDwfEnumConfig', i)
      const info = (cfg: number, what: number): number => int(r, 'FDwfEnumConfigInfo', cfg, what)
      return {
        index: i,
        name: str(name),
        serial: str(sn).replace(/^SN:/, ''),
        userName: str(user),
        id: id[0],
        revision: rev[0],
        opened: int(r, 'FDwfEnumDeviceIsOpened', i) !== 0,
        configs: Array.from({ length: nCfg }, (_, c) => ({
          index: c,
          analogInChannels: info(c, C.DECIAnalogInChannelCount),
          analogOutChannels: info(c, C.DECIAnalogOutChannelCount),
          analogIOChannels: info(c, C.DECIAnalogIOChannelCount),
          digitalIOChannels: info(c, C.DECIDigitalIOChannelCount),
          analogInBuffer: info(c, C.DECIAnalogInBufferSize),
          analogOutBuffer: info(c, C.DECIAnalogOutBufferSize),
          digitalInBuffer: info(c, C.DECIDigitalInBufferSize),
          digitalOutBuffer: info(c, C.DECIDigitalOutBufferSize)
        }))
      }
    })
  }

  /** Opens a device by enumeration index, optionally with a buffer configuration. */
  open(index: number, config?: number): Device {
    const h = new Int32Array(1)
    if (config === undefined) call(this.raw, 'FDwfDeviceOpen', index, h)
    else call(this.raw, 'FDwfDeviceConfigOpen', index, config, h)
    if (h[0] === C.hdwfNone) throw new DwfError('FDwfDeviceOpen', 0, 'no device handle')
    return new Device(this.raw, h[0])
  }

  closeAll(): void {
    call(this.raw, 'FDwfDeviceCloseAll')
  }
}

export type WaveFunc = 'DC' | 'Sine' | 'Square' | 'Triangle' | 'RampUp' | 'RampDown' | 'Noise' | 'Pulse' | 'Trapezium' | 'SinePower'
const FUNC: Record<WaveFunc, number> = {
  DC: C.funcDC,
  Sine: C.funcSine,
  Square: C.funcSquare,
  Triangle: C.funcTriangle,
  RampUp: C.funcRampUp,
  RampDown: C.funcRampDown,
  Noise: C.funcNoise,
  Pulse: C.funcPulse,
  Trapezium: C.funcTrapezium,
  SinePower: C.funcSinePower
}
export type Slope = 'Rise' | 'Fall' | 'Either'
const SLOPE: Record<Slope, number> = { Rise: C.DwfTriggerSlopeRise, Fall: C.DwfTriggerSlopeFall, Either: C.DwfTriggerSlopeEither }

export interface ScopeChannel {
  range?: number
  offset?: number
  /** How samples above the rate are reduced: 0 decimate, 1 average, 2 min/max. */
  filter?: number
}
export interface ScopeCapture {
  /** Channel indexes to capture, from 0. */
  channels: number[]
  /** Sample rate in Hz. */
  rate: number
  samples: number
  /** Per channel, keyed by index. */
  setup?: Record<number, ScopeChannel>
  trigger?: {
    channel: number
    level: number
    slope?: Slope
    position?: number
    autoTimeout?: number
    /** TRIGSRC; the scope's own detector by default. */
    source?: number
    /** 0 edge, 1 pulse, 2 transition. */
    type?: number
    holdoff?: number
    /** Volts; left to the device when unset. */
    hysteresis?: number
    /** 0 decimate, 1 average, 2 min/max. */
    filter?: number
    /** Pulse and transition: 0 less, 1 timeout, 2 more than `length` seconds. */
    lengthCondition?: number
    length?: number
  }
  /** Gives up after this many ms. */
  timeout?: number
}
export interface ScopeResult {
  rate: number
  /** Samples per requested channel, in the order of `channels`. */
  data: Float64Array[]
}

class Scope {
  constructor(
    private raw: DwfRaw,
    private h: number
  ) {}

  channelCount(): number {
    return int(this.raw, 'FDwfAnalogInChannelCount', this.h)
  }

  bufferRange(): { min: number; max: number } {
    const a = new Int32Array(1)
    const b = new Int32Array(1)
    call(this.raw, 'FDwfAnalogInBufferSizeInfo', this.h, a, b)
    return { min: a[0], max: b[0] }
  }

  /** One triggered (or auto) acquisition. Resolves when the buffer is full. */
  async single(o: ScopeCapture): Promise<ScopeResult> {
    const { raw, h } = this
    const n = this.channelCount()
    for (let c = 0; c < n; c++) call(raw, 'FDwfAnalogInChannelEnableSet', h, c, o.channels.includes(c) ? 1 : 0)
    for (const c of o.channels) {
      const s = o.setup?.[c]
      if (s?.range !== undefined) call(raw, 'FDwfAnalogInChannelRangeSet', h, c, s.range)
      if (s?.offset !== undefined) call(raw, 'FDwfAnalogInChannelOffsetSet', h, c, s.offset)
      if (s?.filter !== undefined) call(raw, 'FDwfAnalogInChannelFilterSet', h, c, s.filter)
    }
    call(raw, 'FDwfAnalogInAcquisitionModeSet', h, C.acqmodeSingle)
    call(raw, 'FDwfAnalogInFrequencySet', h, o.rate)
    call(raw, 'FDwfAnalogInBufferSizeSet', h, o.samples)
    if (o.trigger) {
      const t = o.trigger
      call(raw, 'FDwfAnalogInTriggerSourceSet', h, t.source ?? C.trigsrcDetectorAnalogIn)
      call(raw, 'FDwfAnalogInTriggerTypeSet', h, t.type ?? C.trigtypeEdge)
      if (t.holdoff !== undefined) call(raw, 'FDwfAnalogInTriggerHoldOffSet', h, t.holdoff)
      if (t.hysteresis !== undefined) call(raw, 'FDwfAnalogInTriggerHysteresisSet', h, t.hysteresis)
      if (t.filter !== undefined) call(raw, 'FDwfAnalogInTriggerFilterSet', h, t.filter)
      if (t.type && t.length !== undefined) {
        call(raw, 'FDwfAnalogInTriggerLengthConditionSet', h, t.lengthCondition ?? 0)
        call(raw, 'FDwfAnalogInTriggerLengthSet', h, t.length)
      }
      call(raw, 'FDwfAnalogInTriggerChannelSet', h, t.channel)
      call(raw, 'FDwfAnalogInTriggerLevelSet', h, t.level)
      call(raw, 'FDwfAnalogInTriggerConditionSet', h, SLOPE[t.slope ?? 'Rise'])
      call(raw, 'FDwfAnalogInTriggerPositionSet', h, t.position ?? 0)
      call(raw, 'FDwfAnalogInTriggerAutoTimeoutSet', h, t.autoTimeout ?? 0)
    } else call(raw, 'FDwfAnalogInTriggerSourceSet', h, C.trigsrcNone)
    call(raw, 'FDwfAnalogInConfigure', h, 1, 1)

    const deadline = Date.now() + (o.timeout ?? 10_000)
    const sts = new Uint8Array(1)
    for (;;) {
      call(raw, 'FDwfAnalogInStatus', h, 1, sts)
      if (sts[0] === C.DwfStateDone) break
      if (Date.now() > deadline) {
        call(raw, 'FDwfAnalogInConfigure', h, 0, 0)
        throw new DwfError('FDwfAnalogInStatus', 0, 'acquisition timed out')
      }
      await new Promise((r) => setTimeout(r, 2))
    }
    const rate = dbl(raw, 'FDwfAnalogInFrequencyGet', h)
    const data = o.channels.map((c) => {
      const buf = new Float64Array(o.samples)
      call(raw, 'FDwfAnalogInStatusData', h, c, buf, o.samples)
      return buf
    })
    return { rate, data }
  }

  /** The latest single sample per channel, as a voltmeter reads it. */
  sample(channel: number): number {
    const sts = new Uint8Array(1)
    call(this.raw, 'FDwfAnalogInStatus', this.h, 0, sts)
    return dbl(this.raw, 'FDwfAnalogInStatusSample', this.h, channel)
  }

  stop(): void {
    call(this.raw, 'FDwfAnalogInConfigure', this.h, 0, 0)
  }
}

export interface WaveSettings {
  func?: WaveFunc
  frequency?: number
  amplitude?: number
  offset?: number
  symmetry?: number
  phase?: number
  /** Custom samples from −1 to 1, played once per period (sets the function to Custom). */
  data?: ArrayLike<number>
}

/** A modulation node. Amplitude is the modulation depth in percent; offset in percent too. */
export interface Modulation {
  func: WaveFunc
  frequency: number
  amplitude: number
  offset?: number
  phase?: number
  symmetry?: number
  data?: ArrayLike<number>
}

class Wavegen {
  constructor(
    private raw: DwfRaw,
    private h: number
  ) {}

  channelCount(): number {
    return int(this.raw, 'FDwfAnalogOutCount', this.h)
  }

  /** Sets the carrier of one channel. Applies on the next start, or live while it runs. */
  set(ch: number, w: WaveSettings): void {
    this.node(ch, C.AnalogOutNodeCarrier, w)
  }

  /**
   * Sets or turns off amplitude (AM) or frequency (FM) modulation of the carrier. A frequency sweep
   * is FM with a RampUp: depth = (stop − start) / (stop + start) × 100, carrier at the middle.
   */
  modulate(ch: number, kind: 'AM' | 'FM', m: Modulation | null): void {
    const node = kind === 'AM' ? C.AnalogOutNodeAM : C.AnalogOutNodeFM
    if (!m) {
      call(this.raw, 'FDwfAnalogOutNodeEnableSet', this.h, ch, node, 0)
      return
    }
    this.node(ch, node, { func: m.func, frequency: m.frequency, amplitude: m.amplitude, offset: m.offset ?? 0, phase: m.phase ?? 0, symmetry: m.symmetry ?? 50, data: m.data })
  }

  private node(ch: number, node: number, w: WaveSettings): void {
    const { raw, h } = this
    call(raw, 'FDwfAnalogOutNodeEnableSet', h, ch, node, 1)
    if (w.data) {
      call(raw, 'FDwfAnalogOutNodeFunctionSet', h, ch, node, C.funcCustom)
      const d = Float64Array.from(w.data, (x) => Math.max(-1, Math.min(1, x)))
      call(raw, 'FDwfAnalogOutNodeDataSet', h, ch, node, d, d.length)
    } else if (w.func) call(raw, 'FDwfAnalogOutNodeFunctionSet', h, ch, node, FUNC[w.func])
    if (w.frequency !== undefined) call(raw, 'FDwfAnalogOutNodeFrequencySet', h, ch, node, w.frequency)
    if (w.amplitude !== undefined) call(raw, 'FDwfAnalogOutNodeAmplitudeSet', h, ch, node, w.amplitude)
    if (w.offset !== undefined) call(raw, 'FDwfAnalogOutNodeOffsetSet', h, ch, node, w.offset)
    if (w.symmetry !== undefined) call(raw, 'FDwfAnalogOutNodeSymmetrySet', h, ch, node, w.symmetry)
    if (w.phase !== undefined) call(raw, 'FDwfAnalogOutNodePhaseSet', h, ch, node, w.phase)
  }

  start(ch: number): void {
    call(this.raw, 'FDwfAnalogOutConfigure', this.h, ch, 1)
  }

  stop(ch: number): void {
    call(this.raw, 'FDwfAnalogOutConfigure', this.h, ch, 0)
  }

  running(ch: number): boolean {
    const s = new Uint8Array(1)
    call(this.raw, 'FDwfAnalogOutStatus', this.h, ch, s)
    return s[0] === C.DwfStateRunning
  }
}

export interface IONode {
  index: number
  name: string
  units: string
  kind: number
}
export interface IOChannel {
  index: number
  name: string
  label: string
  nodes: IONode[]
}

/** AnalogIO: power supplies, USB and temperature monitors, as channels of nodes. */
class AnalogIO {
  constructor(
    private raw: DwfRaw,
    private h: number
  ) {}

  channels(): IOChannel[] {
    const { raw, h } = this
    const n = int(raw, 'FDwfAnalogIOChannelCount', h)
    return Array.from({ length: n }, (_, c) => {
      const name = Buffer.alloc(32)
      const label = Buffer.alloc(16)
      call(raw, 'FDwfAnalogIOChannelName', h, c, name, label)
      const nn = int(raw, 'FDwfAnalogIOChannelInfo', h, c)
      return {
        index: c,
        name: str(name),
        label: str(label),
        nodes: Array.from({ length: nn }, (_, k) => {
          const nm = Buffer.alloc(32)
          const un = Buffer.alloc(16)
          call(raw, 'FDwfAnalogIOChannelNodeName', h, c, k, nm, un)
          const kind = new Uint8Array(1)
          call(raw, 'FDwfAnalogIOChannelNodeInfo', h, c, k, kind)
          return { index: k, name: str(nm), units: str(un), kind: kind[0] }
        })
      }
    })
  }

  /** Sets a node (e.g. a supply's voltage) and applies it. */
  set(channel: number, node: number, value: number): void {
    call(this.raw, 'FDwfAnalogIOChannelNodeSet', this.h, channel, node, value)
    call(this.raw, 'FDwfAnalogIOConfigure', this.h)
  }

  /** Master enable for every supply. */
  enable(on: boolean): void {
    call(this.raw, 'FDwfAnalogIOEnableSet', this.h, on ? 1 : 0)
    call(this.raw, 'FDwfAnalogIOConfigure', this.h)
  }

  /** Reads fresh status, then the given nodes. */
  read(nodes: [channel: number, node: number][]): number[] {
    call(this.raw, 'FDwfAnalogIOStatus', this.h)
    return nodes.map(([c, k]) => dbl(this.raw, 'FDwfAnalogIOChannelNodeStatus', this.h, c, k))
  }
}

/** Static I/O: per-pin output enable, output value and input state. */
class DigitalIO {
  constructor(
    private raw: DwfRaw,
    private h: number
  ) {}

  /** Pins that can be outputs, as a bit mask. */
  outputMask(): number {
    const m = new Uint32Array(1)
    call(this.raw, 'FDwfDigitalIOOutputEnableInfo', this.h, m)
    return m[0]
  }

  write(enableMask: number, value: number): void {
    call(this.raw, 'FDwfDigitalIOOutputEnableSet', this.h, enableMask >>> 0)
    call(this.raw, 'FDwfDigitalIOOutputSet', this.h, value >>> 0)
    call(this.raw, 'FDwfDigitalIOConfigure', this.h)
  }

  read(): number {
    const v = new Uint32Array(1)
    call(this.raw, 'FDwfDigitalIOStatus', this.h)
    call(this.raw, 'FDwfDigitalIOInputStatus', this.h, v)
    return v[0]
  }
}

export class Device {
  readonly scope: Scope
  readonly wavegen: Wavegen
  readonly io: AnalogIO
  readonly dio: DigitalIO
  readonly logic: LogicIn
  readonly patterns: PatternOut
  readonly protocols: Protocols
  readonly bitbang: BitBang
  private closed = false

  constructor(
    readonly raw: DwfRaw,
    readonly handle: number
  ) {
    this.scope = new Scope(raw, handle)
    this.wavegen = new Wavegen(raw, handle)
    this.io = new AnalogIO(raw, handle)
    this.dio = new DigitalIO(raw, handle)
    this.logic = new LogicIn(raw, handle)
    this.patterns = new PatternOut(raw, handle)
    this.protocols = new Protocols(raw, handle)
    this.bitbang = new BitBang(raw, handle)
  }

  /** Applies settings as they are set (on by default), instead of at Configure. */
  autoConfigure(on: boolean): void {
    call(this.raw, 'FDwfDeviceAutoConfigureSet', this.handle, on ? 1 : 0)
  }

  reset(): void {
    call(this.raw, 'FDwfDeviceReset', this.handle)
  }

  /** Sets a device parameter (DwfParam*, e.g. 4 = on close, 3 = LED brightness). */
  param(param: number, value: number): void {
    call(this.raw, 'FDwfDeviceParamSet', this.handle, param, value)
  }

  /** Drives an external trigger pin from a source (TRIGSRC, 0 = none: the pin is an input). */
  triggerPin(pin: number, src: number): void {
    call(this.raw, 'FDwfDeviceTriggerSet', this.handle, pin, src)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    call(this.raw, 'FDwfDeviceClose', this.handle)
  }
}
