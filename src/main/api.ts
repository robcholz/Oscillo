// The Oscillo API for scripts and the MCP server: instruments as objects over the open device.
// Settings a script changes are reported through `apply`, so the instrument pages follow along.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Hardware } from './hardware'
import { measure, MEASUREMENTS, type MeasurementName } from '../shared/measure'
import type { ScriptApply } from '../shared/script'
import type { WaveRequest } from '../shared/hw'

export interface ApiContext {
  hw: Hardware
  /** Where File writes, e.g. ~/Documents/Oscillo. */
  dataDir: string
  apply: (a: ScriptApply) => void
  /** Called when a script writes a file. */
  wrote?: (path: string) => void
  /** File may open any path. */
  anyPath?: boolean
}

const desc = Symbol.for('oscillo.describe')
/** A short description for the debugger's Variables table. */
export function describe(v: unknown): { v: string; t: string } {
  if (v === null) return { v: 'null', t: 'null' }
  if (v === undefined) return { v: 'undefined', t: 'undefined' }
  if (typeof v === 'number') return { v: Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, ''), t: 'number' }
  if (typeof v === 'string') return { v: JSON.stringify(v.length > 80 ? v.slice(0, 77) + '…' : v), t: 'string' }
  if (typeof v === 'boolean' || typeof v === 'bigint') return { v: String(v), t: typeof v }
  if (typeof v === 'function') return { v: `ƒ ${v.name || 'anonymous'}()`, t: 'function' }
  const o = v as Record<symbol, () => { v: string; t: string }>
  if (typeof o[desc] === 'function') return o[desc]()
  if (Array.isArray(v)) return { v: `Array(${v.length})`, t: 'array' }
  if (ArrayBuffer.isView(v)) return { v: `${v.constructor.name}(${(v as unknown as ArrayLike<number>).length})`, t: v.constructor.name }
  try {
    const s = JSON.stringify(v)
    return { v: s.length > 80 ? s.slice(0, 77) + '…' : s, t: 'object' }
  } catch {
    return { v: '{…}', t: 'object' }
  }
}

const FUNCS = ['Sine', 'Square', 'Triangle', 'RampUp', 'RampDown', 'Noise', 'Pulse', 'Trapezium', 'SinePower', 'DC'] as const
type Func = (typeof FUNCS)[number]

export function createApi(ctx: ApiContext) {
  const { hw } = ctx

  // Scope
  const scope = {
    async single(o: { rate?: number; samples?: number; range?: number; offset?: number; trigger?: { channel: 1 | 2; level: number; slope?: 'Rise' | 'Fall' | 'Either'; position?: number; autoTimeout?: number } } = {}) {
      const rate = o.rate ?? 500e3
      const samples = o.samples ?? 16384
      const range = o.range ?? 10
      const r = await hw.scope({
        channels: [0, 1],
        rate,
        samples,
        range: { 0: range, 1: range },
        offset: o.offset ? { 0: o.offset, 1: o.offset } : undefined,
        trigger: o.trigger ? { channel: o.trigger.channel - 1, level: o.trigger.level, slope: o.trigger.slope ?? 'Rise', position: o.trigger.position ?? 0, autoTimeout: o.trigger.autoTimeout ?? 1 } : undefined
      })
      const time = Float64Array.from({ length: samples }, (_, i) => (i - samples / 2) / r.rate)
      const channel = (n: 1 | 2) => {
        if (n !== 1 && n !== 2) throw new Error('Use channel 1 or 2')
        const v = r.data[n - 1]
        return {
          samples: v,
          time,
          measure(name: MeasurementName) {
            if (!MEASUREMENTS.includes(name)) throw new TypeError(`"${name}" is not a measurement. Use one of ${MEASUREMENTS.join(', ')}.`)
            return measure(v, r.rate, name)
          },
          [desc]: () => ({ v: `Channel ${n} { ${v.length} samples }`, t: 'Channel' })
        }
      }
      return { rate: r.rate, channel, [desc]: () => ({ v: `Capture { ${samples} samples at ${r.rate} S/s }`, t: 'Capture' }) }
    }
  }

  // Wavegen: settings live here, so property sets apply at once while running.
  const gen = [0, 1].map((i) => {
    const st: WaveRequest & { running: boolean } = { func: 'Sine', frequency: 1000, amplitude: 1, offset: 0, symmetry: 50, phase: 0, running: false }
    const push = async () => {
      const { running, ...w } = st
      if (running) await hw.wavegen(i, w)
      ctx.apply({ kind: 'wavegen', channel: i, run: running, type: st.func, freq: st.frequency, amp: st.amplitude, offset: st.offset, sym: st.symmetry, phase: st.phase })
    }
    const ch = {
      configure(s: { type?: Func; frequency?: number; amplitude?: number; offset?: number; symmetry?: number; phase?: number }) {
        if (s.type && !FUNCS.includes(s.type)) throw new TypeError(`"${s.type}" is not a wave type. Use one of ${FUNCS.join(', ')}.`)
        if (s.type) st.func = s.type
        if (s.frequency !== undefined) st.frequency = s.frequency
        if (s.amplitude !== undefined) st.amplitude = s.amplitude
        if (s.offset !== undefined) st.offset = s.offset
        if (s.symmetry !== undefined) st.symmetry = s.symmetry
        if (s.phase !== undefined) st.phase = s.phase
        void push().catch(() => undefined)
      },
      async run() {
        st.running = true
        await push()
      },
      async stop() {
        st.running = false
        await hw.wavegenStop(i)
        ctx.apply({ kind: 'wavegen', channel: i, run: false })
      },
      get running() {
        return st.running
      },
      get frequency() {
        return st.frequency
      },
      set frequency(v: number) {
        ch.configure({ frequency: v })
      },
      get amplitude() {
        return st.amplitude
      },
      set amplitude(v: number) {
        ch.configure({ amplitude: v })
      },
      get offset() {
        return st.offset
      },
      set offset(v: number) {
        ch.configure({ offset: v })
      },
      [desc]: () => ({ v: `Wavegen ${i + 1} { ${st.func} ${st.frequency} Hz ${st.amplitude} V${st.running ? ', running' : ''} }`, t: 'WavegenChannel' })
    }
    return ch
  })
  const wavegen = {
    channel(n: 1 | 2) {
      if (n !== 1 && n !== 2) throw new Error('Use channel 1 or 2')
      return gen[n - 1]
    }
  }

  // Supplies
  const sup = { master: false, pos: { on: false, volts: 5 }, neg: { on: false, volts: -5 } }
  const pushSupplies = () => {
    hw.supplies(sup)
    ctx.apply({ kind: 'supplies', master: sup.master, pos: { ...sup.pos }, neg: { ...sup.neg } })
  }
  const rail = (side: 'pos' | 'neg') => ({
    set(s: { voltage?: number; enable?: boolean }) {
      if (s.voltage !== undefined) {
        if (side === 'pos' ? s.voltage < 0 || s.voltage > 5 : s.voltage > 0 || s.voltage < -5) throw new RangeError(`The ${side === 'pos' ? 'positive' : 'negative'} supply takes ${side === 'pos' ? '0 to 5' : '-5 to 0'} V`)
        sup[side].volts = s.voltage
      }
      if (s.enable !== undefined) sup[side].on = s.enable
      if (s.enable) sup.master = true
      pushSupplies()
    },
    read() {
      const m = hw.monitor()[side]
      return { voltage: m.volts, current: m.amps }
    },
    [desc]: () => ({ v: `${side === 'pos' ? 'V+' : 'V-'} { ${sup[side].volts} V, ${sup[side].on ? 'on' : 'off'} }`, t: 'Rail' })
  })
  const supplies = {
    positive: rail('pos'),
    negative: rail('neg'),
    enable(on: boolean) {
      sup.master = on
      pushSupplies()
    },
    monitor() {
      const m = hw.monitor()
      return { usbVoltage: m.usb.volts, usbCurrent: m.usb.amps, temperature: m.temperature }
    }
  }

  // Logic
  const logic = {
    async single(o: { rate?: number; samples?: number } = {}) {
      if (hw.openInfo()?.key === 'DEMO') throw new Error('The Demo Device does not simulate the Logic Analyzer. Connect a real device to capture.')
      const r = await hw.logic({ rate: o.rate ?? 100e6, samples: o.samples ?? 16384 })
      return {
        rate: r.rate,
        length: r.data.length,
        level: (pin: number, i: number) => ((r.data[i] >> pin) & 1) as 0 | 1,
        [desc]: () => ({ v: `LogicCapture { ${r.data.length} samples }`, t: 'LogicCapture' })
      }
    },
    interpreter(kind: 'SPI' | 'UART', pins: Record<string, number>) {
      const bytes = (values: number[]) => ({ values, hex: () => values.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') })
      return {
        decode(c: { rate: number; length: number; level: (pin: number, i: number) => 0 | 1 }) {
          const frames: { time: number; mosi: ReturnType<typeof bytes>; miso: ReturnType<typeof bytes>; text: string }[] = []
          if (kind === 'SPI') {
            // Mode 0, MSB first: sample MOSI and MISO on SCK rising edges while select is low.
            let mo = 0
            let mi = 0
            let n = 0
            let t0 = 0
            for (let i = 1; i < c.length; i++) {
              if (c.level(pins.select, i)) {
                n = 0
                continue
              }
              if (!c.level(pins.clock, i - 1) && c.level(pins.clock, i)) {
                if (!n) t0 = i
                mo = (mo << 1) | c.level(pins.mosi, i)
                mi = (mi << 1) | c.level(pins.miso, i)
                if (++n === 8) {
                  frames.push({ time: t0 / c.rate, mosi: bytes([mo & 0xff]), miso: bytes([mi & 0xff]), text: '' })
                  n = mo = mi = 0
                }
              }
            }
          } else {
            const bit = c.rate / pins.baud
            for (let i = 1; i < c.length; i++) {
              if (c.level(pins.rx, i - 1) && !c.level(pins.rx, i)) {
                let v = 0
                for (let b = 0; b < 8; b++) v |= c.level(pins.rx, Math.min(c.length - 1, Math.round(i + (b + 1.5) * bit))) << b
                frames.push({ time: i / c.rate, mosi: bytes([]), miso: bytes([v]), text: String.fromCharCode(v) })
                i = Math.round(i + 9.5 * bit)
              }
            }
          }
          return frames
        }
      }
    }
  }

  const io = {
    write(mask: number, value: number) {
      hw.dioWrite(mask, value)
      ctx.apply({ kind: 'dio', mask, value })
    },
    read: () => hw.dioRead()
  }

  const info = hw.openInfo()
  const device = { name: info?.name ?? 'None', serial: info?.serial ?? '' }

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)))

  class File {
    readonly path: string
    constructor(name: string) {
      if (ctx.anyPath && isAbsolute(name.replace(/^~(?=\/|$)/, homedir()))) {
        this.path = name.replace(/^~(?=\/|$)/, homedir())
        return
      }
      if (!/^[\w.\- ]+$/.test(name)) throw new Error(ctx.anyPath ? 'Use a file name like sweep.csv, or a full path' : 'Use a plain file name like sweep.csv. Set Sandbox to Allow Files to use other folders.')
      mkdirSync(ctx.dataDir, { recursive: true })
      this.path = join(ctx.dataDir, name)
    }
    appendLine(line: string) {
      appendFileSync(this.path, line + '\n')
      ctx.wrote?.(this.path)
    }
    write(text: string) {
      writeFileSync(this.path, text)
      ctx.wrote?.(this.path)
    }
    read() {
      return readFileSync(this.path, 'utf8')
    }
    get [desc]() {
      return () => ({ v: `File("${this.path.split('/').pop()}")`, t: 'File' })
    }
  }

  return { scope, wavegen, supplies, logic, io, device, wait, File }
}

export type OscilloApi = ReturnType<typeof createApi>
