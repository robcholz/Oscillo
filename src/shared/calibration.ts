// Software calibration: per-device gain and offset corrections Oscillo applies on top of the
// device's own factory calibration. A reading is `true * gain + offset`.
export interface Corr {
  gain: number
  offset: number
}

export interface CalData {
  app: 'Oscillo'
  kind: 'calibration'
  device: string
  serial: string
  date: string
  scope: [Corr, Corr]
  wavegen: [Corr, Corr]
  supplies: { pos: Corr; neg: Corr }
}

export const IDENTITY: Corr = { gain: 1, offset: 0 }
export const blankCal = (device: string, serial: string): CalData => ({
  app: 'Oscillo',
  kind: 'calibration',
  device,
  serial,
  date: new Date().toISOString(),
  scope: [{ ...IDENTITY }, { ...IDENTITY }],
  wavegen: [{ ...IDENTITY }, { ...IDENTITY }],
  supplies: { pos: { ...IDENTITY }, neg: { ...IDENTITY } }
})

/** What one step measured: the reading shown, and the corrections it found. */
export interface StepResult {
  /** The main reading, in volts. */
  value: number
  expected: number
  corr: Corr
  /** Per channel results where a step does both. */
  detail: string
}

export interface CalStatus {
  /** Saved corrections in use for the open device, or null when none are. */
  active: CalData | null
  /** Corrections measured in this session, not saved yet. */
  pending: CalData | null
}

export const CAL = {
  status: 'cal:status',
  begin: 'cal:begin',
  step: 'cal:step',
  save: 'cal:save',
  clear: 'cal:clear',
  load: 'cal:load'
} as const

export interface CalApi {
  status(): Promise<CalStatus>
  /** Starts a calibration from the saved corrections (or none). */
  begin(): Promise<CalStatus>
  /** Measures step 0 to 5; `ref` is the reference voltage for gain steps, if checked with a meter. */
  step(i: number, ref?: number): Promise<StepResult>
  /** Saves the pending corrections for this device and applies them. */
  save(): Promise<CalStatus>
  /** Removes the saved corrections: only the factory calibration applies. */
  clear(): Promise<CalStatus>
  /** Applies and saves corrections from a file's contents. */
  load(data: CalData): Promise<CalStatus>
}

export const isCal = (x: unknown): x is CalData => {
  const c = x as CalData
  const ok = (k: Corr) => !!k && Number.isFinite(k.gain) && Number.isFinite(k.offset) && k.gain > 0.5 && k.gain < 1.5
  return !!c && c.app === 'Oscillo' && c.kind === 'calibration' && Array.isArray(c.scope) && c.scope.every(ok) && Array.isArray(c.wavegen) && c.wavegen.every(ok) && ok(c.supplies?.pos) && ok(c.supplies?.neg)
}
