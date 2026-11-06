// Owns the device. Loads the WaveForms SDK (the copy bundled in the app first, then a system install),
// lists real devices plus the simulated Demo Device, and serves the renderer's instrument calls.
import { AVR_CHIPS, Avr, Dwf, DwfError, createSimDwf, findLibrary, loadDwf, parseIntelHex, type Device } from '@oscillo/dwf'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IDENTITY, type CalData, type Corr } from '../shared/calibration'
import { loadCal } from './calibration'
import { HW, PROTOCOL_CALLS, type HwDevice, type LogicReply, type LogicRequest, type PatternRequest, type ProtocolCalls, type HwStatus, type Monitor, type OptionsReply, type OptionsRequest, type ScopeReply, type ScopeRequest, type SupplyRequest, type WaveRequest } from '../shared/hw'

const DEMO = 'DEMO'

/** The SDK copy in Oscillo.app/Contents/Frameworks, and the one in the repo during development. */
function bundled(): string[] {
  if (process.platform !== 'darwin') return []
  return [join(process.resourcesPath, '..', 'Frameworks', 'dwf.framework', 'dwf'), join(app.getAppPath(), 'libs', 'dwf', 'macos', 'dwf.framework', 'dwf')]
}

export class Hardware {
  private real: Dwf | null = null
  private sim = new Dwf(createSimDwf())
  private status: HwStatus = { library: null, version: null, error: null, open: null }
  private dev: Device | null = null
  private keys = new Map<string, { dwf: Dwf; index: number }>()
  private names = new Map<string, { name: string; serial: string }>()
  /** Captures run one at a time: the Scope and the meters share the analog inputs. */
  private captures: Promise<unknown> = Promise.resolve()
  /** Saved software corrections for the open device (see calibration.ts). */
  private cal: CalData | null = null

  constructor() {
    try {
      const path = findLibrary(bundled())
      if (path) {
        this.real = new Dwf(loadDwf(path))
        this.status.library = path
        this.status.version = this.real.version()
      } else this.status.error = 'WaveForms SDK not found'
    } catch (e) {
      this.status.error = (e as Error).message
    }
  }

  getStatus(): HwStatus {
    return { ...this.status }
  }

  devices(): HwDevice[] {
    this.keys.clear()
    const list: HwDevice[] = []
    if (this.real) {
      for (const d of this.real.devices()) {
        const net = /^\d+\.\d+\.\d+\.\d+$/.test(d.serial)
        list.push({ key: d.serial, name: d.userName || d.name, serial: net ? d.serial : 'SN:' + d.serial, link: net ? 'LAN' : 'USB', busy: d.opened && this.status.open !== d.serial, configs: d.configs.length })
        this.keys.set(d.serial, { dwf: this.real, index: d.index })
      }
    }
    list.push({ key: DEMO, name: 'Demo Device', serial: 'Simulated', link: 'SIM', busy: false, configs: 4 })
    for (const d of list) this.names.set(d.key, { name: d.name, serial: d.serial })
    this.keys.set(DEMO, { dwf: this.sim, index: 0 })
    return list
  }

  open(key: string, config: number): void {
    this.close()
    if (!this.keys.size) this.devices()
    const at = this.keys.get(key)
    if (!at) throw new Error(`Device ${key} is not connected`)
    // Buffer configurations are numbered from 1 in the app and from 0 in the SDK.
    this.dev = at.dwf.open(at.index, Math.max(0, config - 1))
    this.status.open = key
    this.cal = loadCal(this.openInfo()!.serial)
  }

  calibration(): CalData | null {
    return this.cal
  }
  setCalibration(c: CalData | null): void {
    this.cal = c
  }

  close(): void {
    this.dev?.close()
    this.dev = null
    this.status.open = null
    this.cal = null
    this.dmmSet = ''
  }

  private need(): Device {
    if (!this.dev) throw new Error('No device is open. Connect a device first.')
    return this.dev
  }

  /** The open device, for scripts and the MCP server. Throws when none is open. */
  device(): Device {
    return this.need()
  }

  /** Name and serial of the open device, or null. */
  openInfo(): { key: string; name: string; serial: string } | null {
    const key = this.status.open
    if (!key) return null
    const d = this.names.get(key)
    return { key, name: d?.name ?? key, serial: d?.serial ?? key }
  }

  async scope(r: ScopeRequest, o: { raw?: boolean } = {}): Promise<ScopeReply> {
    const setup: Record<number, { range?: number; offset?: number; filter?: number }> = {}
    for (const c of r.channels) setup[c] = { range: r.range?.[c], offset: r.offset?.[c], filter: r.filter?.[c] }
    const next = this.captures.then(() => this.need().scope.single({ channels: r.channels, rate: r.rate, samples: r.samples, setup, trigger: r.trigger, timeout: 5000 }))
    this.captures = next.catch(() => undefined)
    const rep = await next
    const cal = this.cal
    if (cal && !o.raw)
      r.channels.forEach((c, k) => {
        const { gain, offset } = cal.scope[c] ?? IDENTITY
        if (gain === 1 && offset === 0) return
        const v = rep.data[k]
        for (let i = 0; i < v.length; i++) v[i] = (v[i] - offset) / gain
      })
    return rep
  }

  wavegen(ch: number, w: WaveRequest, o: { raw?: boolean } = {}): void {
    const d = this.need()
    const { gain, offset } = (!o.raw && this.cal?.wavegen[ch]) || IDENTITY
    d.wavegen.set(ch, { func: w.func, frequency: w.frequency, amplitude: w.amplitude / gain, offset: (w.offset - offset) / gain, symmetry: w.symmetry, phase: w.phase, data: w.data })
    d.wavegen.modulate(ch, 'AM', w.am ?? null)
    d.wavegen.modulate(ch, 'FM', w.fm ?? null)
    d.wavegen.start(ch)
  }

  wavegenStop(ch: number): void {
    this.need().wavegen.stop(ch)
  }

  supplies(r: SupplyRequest, o: { raw?: boolean } = {}): void {
    const io = this.need().io
    const fix = (v: number, c: Corr | undefined) => (o.raw || !c ? v : (v - c.offset) / c.gain)
    io.set(0, 1, fix(r.pos.volts, this.cal?.supplies.pos))
    io.set(1, 1, fix(r.neg.volts, this.cal?.supplies.neg))
    io.set(0, 0, r.pos.on ? 1 : 0)
    io.set(1, 0, r.neg.on ? 1 : 0)
    io.enable(r.master)
  }

  monitor(): Monitor {
    const io = this.need().io
    const ch = io.channels()
    const find = (label: RegExp, node: RegExp): [number, number] | null => {
      const c = ch.find((x) => label.test(x.label) || label.test(x.name))
      const n = c?.nodes.find((k) => node.test(k.name))
      return c && n ? [c.index, n.index] : null
    }
    const want = [find(/V\+|Positive/, /Voltage/), find(/V\+|Positive/, /Current/), find(/V-|Negative/, /Voltage/), find(/V-|Negative/, /Current/), find(/USB/, /Voltage/), find(/USB/, /Current/), find(/USB|System/, /Temp/)]
    const nodes = want.filter((x): x is [number, number] => !!x)
    const vals = io.read(nodes)
    let k = 0
    const v = want.map((x) => (x ? vals[k++] : NaN))
    return { pos: { volts: v[0], amps: v[1] }, neg: { volts: v[2], amps: v[3] }, usb: { volts: v[4], amps: v[5] }, temperature: v[6] }
  }

  /** One DMM reading: finds the AnalogIO channel with DMM, Range and Measure nodes by their kind. */
  dmm(mode: number, range: number): number {
    const io = this.need().io
    // ANALOGIO node kinds from dwf.h.
    const ch = io.channels().find((c) => c.nodes.some((n) => n.kind === 6))
    if (!ch) throw new Error('This device has no DMM')
    const node = (kind: number) => ch.nodes.find((n) => n.kind === kind)
    const fn = node(6)!
    const rng = node(7)
    const meas = node(8)
    if (!meas) throw new Error('This device has no DMM reading')
    if (this.dmmSet !== `${mode}/${range}`) {
      io.set(ch.index, fn.index, mode)
      if (rng) io.set(ch.index, rng.index, range)
      io.enable(true)
      this.dmmSet = `${mode}/${range}`
    }
    return io.read([[ch.index, meas.index]])[0]
  }
  private dmmSet = ''

  /** Applies Device Options one by one; an option the device lacks is reported, not fatal. */
  options(o: OptionsRequest): OptionsReply {
    const d = this.need()
    const out: OptionsReply = { applied: [], unsupported: [] }
    const tryIt = (name: string, fn: () => void) => {
      try {
        fn()
        out.applied.push(name)
      } catch {
        out.unsupported.push(name)
      }
    }
    // DwfParam numbers from dwf.h.
    tryIt('On Close', () => d.param(4, o.onClose))
    tryIt('Keep USB Power', () => d.param(2, o.keepUsb ? 1 : 0))
    tryIt('USB Current Limit', () => d.param(6, Math.round(o.usbLimit * 1000)))
    tryIt('LED Brightness', () => d.param(3, Math.round(o.led)))
    tryIt('Audio Output', () => d.param(5, o.audio ? 1 : 0))
    tryIt('Reference Clock', () => d.param(10, o.clockMode))
    if (o.clockMode === 2) tryIt('Reference Frequency', () => d.param(9, Math.round(o.refFreq)))
    tryIt('System Frequency', () => d.param(8, Math.round(o.sysFreq)))
    tryIt('Logic Level', () => d.param(13, Math.round(o.digitalVolts * 1000)))
    tryIt('Input Threshold', () => d.param(15, Math.round(o.threshold * 1000)))
    // Digital Discovery style VIO nodes: pull enable and direction bit fields, drive (mA) and slew.
    const vio = d.io.channels().find((c) => c.nodes.some((n) => /drive/i.test(n.name)))
    const node = (re: RegExp) => vio?.nodes.find((n) => re.test(n.name))
    const setNode = (name: string, re: RegExp, v: number) => {
      const n = node(re)
      if (!vio || !n) return void out.unsupported.push(name)
      tryIt(name, () => d.io.set(vio.index, n.index, v))
    }
    setNode('Drive Strength', /drive/i, o.driveMa)
    setNode('Slew', /slew/i, o.slew)
    if (node(/pull/i)) {
      const en = node(/pull.*(en|enable)|^pull$/i)
      const dir = node(/pull.*(dir|up)/i)
      tryIt('Pull', () => {
        if (en) d.io.set(vio!.index, en.index, o.pull === 'None' ? 0 : 0xffffffff)
        if (dir && o.pull !== 'None') d.io.set(vio!.index, dir.index, o.pull === 'Up' ? 0xffffffff : 0)
      })
    } else out.unsupported.push('Pull')
    o.triggers.forEach((src, i) => tryIt(`Trigger ${i + 1}`, () => d.triggerPin(i, src)))
    return out
  }

  dioWrite(mask: number, value: number): void {
    this.need().dio.write(mask, value)
  }

  dioRead(): number {
    return this.need().dio.read()
  }

  logic(r: LogicRequest): Promise<LogicReply> {
    return this.need().logic.single({ ...r, timeout: 5000 })
  }

  patterns(p: PatternRequest[]): void {
    this.need().patterns.start(p)
  }

  patternsStop(): void {
    this.need().patterns.stop()
  }

  protocol(name: keyof ProtocolCalls, args: unknown[]): unknown {
    if (!PROTOCOL_CALLS.includes(name)) throw new Error(`Unknown protocol call ${name}`)
    const d = this.need()
    const p = d.protocols
    const b = d.bitbang
    const avr = new Avr(p)
    const image = (path: string, chip: string) => {
      const c = AVR_CHIPS[chip]
      if (!c) throw new Error(`Unknown chip ${chip}`)
      return { img: parseIntelHex(readFileSync(path.replace(/^~(?=\/|$)/, homedir()), 'utf8'), c.flashBytes), c }
    }
    const calls: { [K in keyof ProtocolCalls]: (...a: Parameters<ProtocolCalls[K]>) => ReturnType<ProtocolCalls[K]> } = {
      uartSetup: (u) => p.uartSetup(u),
      uartSend: (data) => p.uartSend(data),
      uartReceive: (max) => p.uartReceive(max),
      spiSetup: (s) => p.spiSetup(s),
      spiTransfer: (tx) => p.spiTransfer(tx),
      i2cSetup: (s) => p.i2cSetup(s),
      i2cTransfer: (a, tx, n) => p.i2cTransfer(a, tx, n),
      canSetup: (s) => p.canSetup(s),
      canSend: (f) => p.canSend(f),
      canReceive: () => p.canReceive(),
      jtagSetup: (pins) => b.jtagSetup(pins),
      jtagReset: () => b.jtagReset(),
      jtagShift: (reg, len, hex) => b.jtagShift(reg, len, BigInt('0x' + (hex || '0'))).toString(16).toUpperCase(),
      jtagScan: () => b.jtagScan(),
      swdSetup: (pins) => b.swdSetup(pins),
      swdConnect: () => b.swdConnect(),
      swdTransfer: (ap, read, addr, value) => b.swdTransfer(ap, read, addr, value),
      avrEnter: (s) => {
        p.spiSetup(s)
        return avr.enter()
      },
      avrLeave: () => avr.leave(),
      avrFuses: () => avr.fuses(),
      avrWriteFuses: (f) => avr.writeFuses(f),
      avrReadFlashWord: (w) => avr.readFlashWord(w),
      avrReadEeprom: (a) => avr.readEeprom(a),
      avrErase: () => avr.erase(),
      avrProgram: (path, chip) => {
        const { img, c } = image(path, chip)
        return avr.program(img, c)
      },
      avrVerify: (path, chip) => avr.verify(image(path, chip).img)
    }
    return (calls[name] as (...a: unknown[]) => unknown)(...args)
  }
}

/** Registers the IPC handlers. Errors reach the renderer with the SDK's message. */
export function registerHardware(): Hardware {
  const hw = new Hardware()
  const handle = <A extends unknown[], R>(ch: string, fn: (...a: A) => R | Promise<R>): void => {
    ipcMain.handle(ch, async (_e, ...a: unknown[]) => {
      try {
        return await fn(...(a as A))
      } catch (e) {
        throw new Error(e instanceof DwfError ? e.message : (e as Error).message)
      }
    })
  }
  handle(HW.status, () => hw.getStatus())
  handle(HW.devices, () => hw.devices())
  handle(HW.open, (key: string, config: number) => hw.open(key, config))
  handle(HW.close, () => hw.close())
  handle(HW.scope, (r: ScopeRequest) => hw.scope(r))
  handle(HW.wavegen, (ch: number, w: WaveRequest) => hw.wavegen(ch, w))
  handle(HW.wavegenStop, (ch: number) => hw.wavegenStop(ch))
  handle(HW.supplies, (r: SupplyRequest) => hw.supplies(r))
  handle(HW.monitor, () => hw.monitor())
  handle(HW.dioWrite, (m: number, v: number) => hw.dioWrite(m, v))
  handle(HW.dioRead, () => hw.dioRead())
  handle(HW.logic, (r: LogicRequest) => hw.logic(r))
  handle(HW.patterns, (p: PatternRequest[]) => hw.patterns(p))
  handle(HW.patternsStop, () => hw.patternsStop())
  handle(HW.dmm, (m: number, r: number) => hw.dmm(m, r))
  handle(HW.options, (o: OptionsRequest) => hw.options(o))
  handle(HW.protocol, (name: keyof ProtocolCalls, ...args: unknown[]) => hw.protocol(name, args))
  app.on('before-quit', () => hw.close())
  return hw
}
