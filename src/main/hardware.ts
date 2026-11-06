// Owns the device. Loads the WaveForms SDK (the copy bundled in the app first, then a system install),
// lists real devices plus the simulated Demo Device, and serves the renderer's instrument calls.
import { AVR_CHIPS, Avr, Dwf, DwfError, createSimDwf, findLibrary, loadDwf, parseIntelHex, type Device } from '@oscillo/dwf'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { HW, PROTOCOL_CALLS, type HwDevice, type LogicReply, type LogicRequest, type PatternRequest, type ProtocolCalls, type HwStatus, type Monitor, type ScopeReply, type ScopeRequest, type SupplyRequest, type WaveRequest } from '../shared/hw'

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
  /** Captures run one at a time: the Scope and the meters share the analog inputs. */
  private captures: Promise<unknown> = Promise.resolve()

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
  }

  close(): void {
    this.dev?.close()
    this.dev = null
    this.status.open = null
  }

  private need(): Device {
    if (!this.dev) throw new Error('No device is open')
    return this.dev
  }

  async scope(r: ScopeRequest): Promise<ScopeReply> {
    const setup: Record<number, { range?: number; offset?: number }> = {}
    for (const c of r.channels) setup[c] = { range: r.range?.[c], offset: r.offset?.[c] }
    const next = this.captures.then(() => this.need().scope.single({ channels: r.channels, rate: r.rate, samples: r.samples, setup, trigger: r.trigger, timeout: 5000 }))
    this.captures = next.catch(() => undefined)
    return next
  }

  wavegen(ch: number, w: WaveRequest): void {
    const d = this.need()
    d.wavegen.set(ch, { func: w.func, frequency: w.frequency, amplitude: w.amplitude, offset: w.offset, symmetry: w.symmetry, phase: w.phase, data: w.data })
    d.wavegen.modulate(ch, 'AM', w.am ?? null)
    d.wavegen.modulate(ch, 'FM', w.fm ?? null)
    d.wavegen.start(ch)
  }

  wavegenStop(ch: number): void {
    this.need().wavegen.stop(ch)
  }

  supplies(r: SupplyRequest): void {
    const io = this.need().io
    io.set(0, 1, r.pos.volts)
    io.set(1, 1, r.neg.volts)
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
  handle(HW.protocol, (name: keyof ProtocolCalls, ...args: unknown[]) => hw.protocol(name, args))
  app.on('before-quit', () => hw.close())
  return hw
}
