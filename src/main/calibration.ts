// Guided calibration: measures each instrument against the scope (and the scope against the
// wavegen, or a reference voltage checked with a meter), and stores the corrections per device.
import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { blankCal, CAL, IDENTITY, isCal, type CalData, type CalStatus, type Corr, type StepResult } from '../shared/calibration'
import type { Hardware } from './hardware'

const dir = (): string => join(app.getPath('userData'), 'calibration')
const fileFor = (serial: string): string => join(dir(), `${serial.replace(/[^\w.-]/g, '_')}.json`)

/** Saved corrections for a device serial, or null. */
export function loadCal(serial: string): CalData | null {
  try {
    const p = fileFor(serial)
    if (!existsSync(p)) return null
    const c = JSON.parse(readFileSync(p, 'utf8'))
    return isCal(c) ? c : null
  } catch {
    return null
  }
}

const mean = (v: Float64Array) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const fmt = (v: number) => `${v.toFixed(3)} V`

export function registerCalibration(hw: Hardware): void {
  let pending: CalData | null = null
  const status = (): CalStatus => ({ active: hw.calibration(), pending })
  const info = () => {
    const i = hw.openInfo()
    if (!i) throw new Error('No device is open. Connect the device you want to calibrate.')
    return i
  }

  /** Mean of both scope inputs, raw (no correction), 10 ms at 100 kS/s on the ±25 V range. */
  const read = async (): Promise<[number, number]> => {
    await wait(150)
    const r = await hw.scope({ channels: [0, 1], rate: 100e3, samples: 1000, range: { 0: 50, 1: 50 } }, { raw: true })
    return [mean(r.data[0]), mean(r.data[1])]
  }
  /** Raw reading corrected with the pending scope calibration. */
  const readCorrected = async (): Promise<[number, number]> => {
    const [a, b] = await read()
    const s = pending!.scope
    return [(a - s[0].offset) / s[0].gain, (b - s[1].offset) / s[1].gain]
  }
  const dc = (ch: number, v: number) => hw.wavegen(ch, { func: 'DC', frequency: 1000, amplitude: 0, offset: v, symmetry: 50, phase: 0 }, { raw: true })
  const check = (what: string, c: Corr, got: number, want: number): Corr => {
    if (!Number.isFinite(c.gain) || Math.abs(c.gain - 1) > 0.15 || Math.abs(c.offset) > 0.5)
      throw new Error(`${what} read ${fmt(got)} where ${fmt(want)} was expected. Check the wiring, then measure again.`)
    return c
  }
  const twoPoint = (what: string, p: number, n: number, hi: number, lo: number): Corr => {
    const gain = (p - n) / (hi - lo)
    return check(what, { gain, offset: p - gain * hi }, p, hi)
  }

  const steps: ((ref: number | undefined) => Promise<StepResult>)[] = [
    // 0. Scope offset with the inputs open.
    async () => {
      const [a, b] = await read()
      pending!.scope = [check('Channel 1', { gain: pending!.scope[0].gain, offset: a }, a, 0), check('Channel 2', { gain: pending!.scope[1].gain, offset: b }, b, 0)]
      return { value: (a + b) / 2, expected: 0, corr: { gain: 1, offset: (a + b) / 2 }, detail: `C1 ${fmt(a)}, C2 ${fmt(b)}` }
    },
    // 1–2. Scope gain against Wavegen 1 at ±ref.
    ...[0, 1].map((ch) => async (ref: number | undefined) => {
      const v = ref ?? 4
      try {
        dc(0, v)
        const p = (await read())[ch]
        dc(0, -v)
        const n = (await read())[ch]
        const c = twoPoint(`Channel ${ch + 1}`, p, n, v, -v)
        pending!.scope[ch] = c
        return { value: p, expected: v, corr: c, detail: `${fmt(p)} at +${v} V, ${fmt(n)} at −${v} V` }
      } finally {
        hw.wavegenStop(0)
      }
    }),
    // 3. Wavegen 1 and 2 against the calibrated scope at ±2 V.
    async () => {
      try {
        dc(0, 2)
        dc(1, 2)
        const [p1, p2] = await readCorrected()
        dc(0, -2)
        dc(1, -2)
        const [n1, n2] = await readCorrected()
        pending!.wavegen = [twoPoint('Wavegen 1', p1, n1, 2, -2), twoPoint('Wavegen 2', p2, n2, 2, -2)]
        return { value: p1, expected: 2, corr: pending!.wavegen[0], detail: `W1 ${fmt(p1)} / ${fmt(n1)}, W2 ${fmt(p2)} / ${fmt(n2)}` }
      } finally {
        hw.wavegenStop(0)
        hw.wavegenStop(1)
      }
    },
    // 4. Supplies at 1 V and 3 V (and −1, −3 V).
    async () => {
      const set = (v: number) => hw.supplies({ master: true, pos: { on: true, volts: v }, neg: { on: true, volts: -v } }, { raw: true })
      try {
        set(1)
        await wait(300)
        const [p1, n1] = await readCorrected()
        set(3)
        await wait(300)
        const [p3, n3] = await readCorrected()
        pending!.supplies = { pos: twoPoint('V+', p3, p1, 3, 1), neg: twoPoint('V−', n3, n1, -3, -1) }
        return { value: p3, expected: 3, corr: pending!.supplies.pos, detail: `V+ ${fmt(p3)}, V− ${fmt(n3)}` }
      } finally {
        hw.supplies({ master: false, pos: { on: false, volts: 0 }, neg: { on: false, volts: 0 } }, { raw: true })
      }
    },
    // 5. Voltmeter zero: both inputs grounded; what remains moves into the scope offsets.
    async () => {
      const [a, b] = await readCorrected()
      const s = pending!.scope
      pending!.scope = [
        check('Channel 1', { gain: s[0].gain, offset: s[0].offset + a * s[0].gain }, a, 0),
        check('Channel 2', { gain: s[1].gain, offset: s[1].offset + b * s[1].gain }, b, 0)
      ]
      return { value: (a + b) / 2, expected: 0, corr: { ...IDENTITY, offset: (a + b) / 2 }, detail: `C1 ${fmt(a)}, C2 ${fmt(b)}` }
    }
  ]

  ipcMain.handle(CAL.status, () => status())
  ipcMain.handle(CAL.begin, () => {
    const i = info()
    pending = structuredClone(hw.calibration() ?? blankCal(i.name, i.serial))
    return status()
  })
  ipcMain.handle(CAL.step, async (_e, i: number, ref?: number) => {
    if (!pending) {
      const d = info()
      pending = structuredClone(hw.calibration() ?? blankCal(d.name, d.serial))
    }
    const fn = steps[i]
    if (!fn) throw new Error(`There is no step ${i + 1}`)
    return fn(ref)
  })
  ipcMain.handle(CAL.save, () => {
    const i = info()
    if (!pending) throw new Error('Nothing measured yet')
    const c: CalData = { ...pending, device: i.name, serial: i.serial, date: new Date().toISOString() }
    mkdirSync(dir(), { recursive: true })
    writeFileSync(fileFor(i.serial), JSON.stringify(c, null, 1))
    hw.setCalibration(c)
    pending = null
    return status()
  })
  ipcMain.handle(CAL.clear, () => {
    const i = info()
    rmSync(fileFor(i.serial), { force: true })
    hw.setCalibration(null)
    pending = null
    return status()
  })
  ipcMain.handle(CAL.load, (_e, c: unknown) => {
    const i = info()
    if (!isCal(c)) throw new Error('This is not an Oscillo calibration file, or its corrections are out of range')
    const data: CalData = { ...c, device: i.name, serial: i.serial }
    mkdirSync(dir(), { recursive: true })
    writeFileSync(fileFor(i.serial), JSON.stringify(data, null, 1))
    hw.setCalibration(data)
    pending = null
    return status()
  })
}
