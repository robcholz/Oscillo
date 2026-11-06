// Keeps real hardware in step with the instrument settings, and polls what the device reports back.
// The Demo Device keeps the renderer's own simulations; everything here runs only on real hardware,
// except the monitor (temperature, USB power), which the simulated device answers too.
import { create } from 'zustand'
import type { Monitor, WaveRequest } from '../../shared/hw'
import { deviceById, hw } from './devices'
import { useStore } from './store'
import type { WaveType } from './sim/wave'
import type { Reading } from './views/meters'

interface HwLive {
  /** Latest DC / AC / RMS of C1 and C2, while a meter wants them. */
  meters: [Reading, Reading] | null
  monitor: Monitor | null
  /** DIO input levels. */
  dio: number | null
}
export const useHwLive = create<HwLive>()(() => ({ meters: null, monitor: null, dio: null }))

/** True when the connected device is real hardware (not the Demo Device). */
export const isHardware = (): boolean => {
  const d = deviceById(useStore.getState().device)
  return !!hw && !!d && d.link !== 'SIM'
}

const FUNC: Partial<Record<WaveType, WaveRequest['func']>> = {
  Sine: 'Sine',
  Square: 'Square',
  Triangle: 'Triangle',
  'Ramp Up': 'RampUp',
  'Ramp Down': 'RampDown',
  Noise: 'Noise',
  Trapezium: 'Trapezium',
  'Sine Power': 'SinePower',
  DC: 'DC'
}

interface WaveCh {
  run: boolean
  out: boolean
  type: WaveType
  freq: number
  amp: number
  offset: number
  sym: number
  phase: number
}

/** Starts or stops a generator channel to match its settings. Custom and Play fall back to a sine. */
export async function pushWave(i: number, c: WaveCh, on: boolean): Promise<void> {
  if (!hw) return
  if (!on || !c.run || !c.out) return hw.wavegenStop(i)
  return hw.wavegen(i, { func: FUNC[c.type] ?? 'Sine', frequency: c.freq, amplitude: c.amp, offset: c.offset, symmetry: c.sym, phase: c.phase })
}

export async function pushSupplies(s: { master: boolean; pos: { on: boolean; volts: number }; neg: { on: boolean; volts: number } }): Promise<void> {
  await hw?.supplies({ master: s.master, pos: { on: s.pos.on, volts: s.pos.volts }, neg: { on: s.neg.on, volts: s.neg.volts } })
}

export async function pushDio(mask: number, value: number): Promise<void> {
  await hw?.dioWrite(mask, value)
}

/** C1 and C2 as DC, AC RMS and true RMS, from a short capture (10 ms at 100 kS/s). */
export async function measure(): Promise<[Reading, Reading]> {
  const r = await hw!.scope({ channels: [0, 1], rate: 100e3, samples: 1000, range: { 0: 50, 1: 50 } })
  const one = (v: Float64Array): Reading => {
    let sum = 0
    let sq = 0
    for (const x of v) {
      sum += x
      sq += x * x
    }
    const dc = sum / v.length
    const rms = Math.sqrt(sq / v.length)
    return { dc, ac: Math.sqrt(Math.max(0, rms * rms - dc * dc)), rms }
  }
  return [one(r.data[0]), one(r.data[1])]
}

let meterUsers = 0
/** Meters call this while they show live readings; the poll then captures C1 and C2. */
export function wantMeters(on: boolean): () => void {
  if (!on) return () => {}
  meterUsers++
  return () => {
    meterUsers--
    if (!meterUsers) useHwLive.setState({ meters: null })
  }
}

let started = false
/** Polls the device twice a second. Call once at launch. */
export function startHwSync(): void {
  if (started || !hw) return
  started = true
  let busy = false
  setInterval(async () => {
    const app = useStore.getState()
    if (busy || !app.device) {
      if (!app.device) useHwLive.setState({ meters: null, monitor: null, dio: null })
      return
    }
    busy = true
    try {
      const monitor = await hw!.monitor().catch(() => null)
      const real = isHardware()
      const dio = real ? await hw!.dioRead().catch(() => null) : null
      const meters = real && meterUsers > 0 && app.running ? await measure().catch(() => null) : null
      useHwLive.setState({ monitor, dio, meters })
    } finally {
      busy = false
    }
  }, 500)
}

type Sub = { subscribe: (fn: () => void) => () => void }
/**
 * Pushes `read()` to the device with `push` whenever it changes, and again after connecting, while
 * real hardware is connected. Failures show as a toast.
 */
export function follow<T>(stores: Sub[], read: () => T, push: (v: T) => Promise<void>, what: string): void {
  if (!hw) return
  let last = ''
  let dev: string | null = null
  const run = (): void => {
    const app = useStore.getState()
    if (app.device !== dev) {
      dev = app.device
      last = ''
    }
    if (!isHardware()) return
    const v = read()
    const key = JSON.stringify(v)
    if (key === last) return
    last = key
    push(v).catch((e: Error) => app.toast(`Could not update ${what}`, { detail: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
  }
  for (const s of [useStore, ...stores]) s.subscribe(run)
  // The device list arrives after launch; check again once it has.
  setTimeout(run, 0)
}
