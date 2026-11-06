// Keeps real hardware in step with the instrument settings, and polls what the device reports back.
// The Demo Device keeps the renderer's own simulations; everything here runs only on real hardware,
// except the monitor (temperature, USB power), which the simulated device answers too.
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { Monitor, ScopeReply, ScopeRequest, WaveRequest } from '../../shared/hw'
import { deviceById, hw } from './devices'
import { useStore } from './store'
import type { WaveType } from './sim/wave'
import type { Complex } from './sim/network'
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

const resyncs: (() => void)[] = []
/** Pushes every followed setting again, e.g. after an analyzer borrowed the generator. */
export const resync = (): void => resyncs.forEach((f) => f())

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
  resyncs.push(() => {
    last = ''
    run()
  })
  // The device list arrives after launch; check again once it has.
  setTimeout(run, 0)
}

/**
 * Captures from the scope inputs back to back while `req` is set, and returns the latest capture.
 * Failures show once as a toast, then capturing stops until `req` changes.
 */
export function useCapture(req: ScopeRequest | null): ScopeReply | null {
  const [cap, setCap] = useState<ScopeReply | null>(null)
  const key = req ? JSON.stringify(req) : null
  const latest = useRef(req)
  latest.current = req
  useEffect(() => {
    if (!key || !hw) return
    let alive = true
    void (async () => {
      while (alive) {
        try {
          const r = await hw!.scope(latest.current!)
          if (alive) setCap(r)
        } catch (e) {
          if (alive) useStore.getState().toast('Capture failed', { detail: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
          return
        }
        await new Promise((r) => setTimeout(r, 50))
      }
    })()
    return () => {
      alive = false
    }
  }, [key])
  return cap
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Amplitude and phase of `v` at frequency f, over a whole number of periods (single-bin DFT). */
export function tone(v: ArrayLike<number>, rate: number, f: number): Complex {
  const periods = Math.floor((v.length * f) / rate)
  const n = periods >= 1 ? Math.round((periods * rate) / f) : v.length
  let re = 0
  let im = 0
  const w = (2 * Math.PI * f) / rate
  for (let i = 0; i < n; i++) {
    re += v[i] * Math.cos(w * i)
    im -= v[i] * Math.sin(w * i)
  }
  return { re: (2 * re) / n, im: (2 * im) / n }
}

export interface Stimulus {
  amp: number
  offset: number
  /** Periods to capture at each frequency. */
  periods: number
  /** Extra wait after changing frequency, in seconds. */
  settle: number
  /** Generator channel (0 = W1). */
  gen?: number
}

/** Drives a sine at f on the generator, then captures C1 and C2 and returns each one's tone at f. */
export async function respond(f: number, st: Stimulus): Promise<[Complex, Complex]> {
  const samples = 4096
  const rate = Math.min(100e6, Math.max(1e3, (f * samples) / Math.max(1, st.periods)))
  await hw!.wavegen(st.gen ?? 0, { func: 'Sine', frequency: f, amplitude: st.amp, offset: st.offset, symmetry: 50, phase: 0 })
  await sleep(Math.min(1000, st.settle * 1000 + (2 / f) * 1000))
  const r = await hw!.scope({ channels: [0, 1], rate, samples, range: { 0: Math.max(1, st.amp * 2.5), 1: Math.max(1, st.amp * 2.5) } })
  return [tone(r.data[0], r.rate, f), tone(r.data[1], r.rate, f)]
}

/**
 * Sweeps `freqs` on real hardware while `run`, restarting when done, like the analyzers' own sweep.
 * `fn` turns each frequency into a point. When the sweep stops, the generator goes back to its
 * Wavegen settings.
 */
export function useSweep(run: boolean, freqs: number[], fn: (f: number) => Promise<Complex>, opts: { gen?: number; once?: boolean; onDone?: () => void } = {}): { pts: Complex[]; done: number } {
  const [state, setState] = useState<{ pts: Complex[]; done: number }>({ pts: [], done: 0 })
  const ref = useRef(fn)
  ref.current = fn
  const done = useRef(opts.onDone)
  done.current = opts.onDone
  const key = run && hw ? JSON.stringify([freqs, opts.gen ?? 0, !!opts.once]) : null
  useEffect(() => {
    if (!key) return
    let alive = true
    void (async () => {
      try {
        while (alive) {
          const pts: Complex[] = []
          setState({ pts, done: 0 })
          for (const f of freqs) {
            if (!alive) break
            pts.push(await ref.current(f))
            if (alive) setState({ pts: pts.slice(), done: pts.length })
          }
          if (opts.once) {
            if (alive) done.current?.()
            break
          }
        }
      } catch (e) {
        if (alive) useStore.getState().toast('Sweep failed', { detail: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      } finally {
        await hw?.wavegenStop(opts.gen ?? 0).catch(() => undefined)
        resync()
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

/** Complex helpers for the analyzers. */
export const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im || 1e-30
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}
export const csub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im })
export const cscale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k })
