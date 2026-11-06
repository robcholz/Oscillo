// The hardware API the main process offers the renderer, over IPC. Real devices come from the
// WaveForms SDK; the Demo Device is the simulated Analog Discovery 3 from @oscillo/dwf.

export type Link = 'USB' | 'LAN' | 'SIM'

export interface HwDevice {
  /** Stable key: the serial number, or "DEMO". */
  key: string
  name: string
  serial: string
  link: Link
  /** Opened by another program (WaveForms, a script). */
  busy: boolean
  /** Buffer configurations the device offers. */
  configs: number
}

export interface HwStatus {
  /** Path of the loaded SDK library, or null when only the Demo Device is available. */
  library: string | null
  version: string | null
  /** Why the SDK could not be loaded. */
  error: string | null
  /** Key of the open device. */
  open: string | null
}

export interface ScopeRequest {
  channels: number[]
  rate: number
  samples: number
  range?: Record<number, number>
  offset?: Record<number, number>
  trigger?: { channel: number; level: number; slope: 'Rise' | 'Fall' | 'Either'; position: number; autoTimeout: number }
}
export interface ScopeReply {
  rate: number
  data: Float64Array[]
}

export interface WaveRequest {
  func: 'DC' | 'Sine' | 'Square' | 'Triangle' | 'RampUp' | 'RampDown' | 'Noise' | 'Pulse' | 'Trapezium' | 'SinePower'
  frequency: number
  amplitude: number
  offset: number
  symmetry: number
  phase: number
  /** Custom samples, −1 to 1, one period (func is then ignored). */
  data?: number[]
  /** Amplitude modulation; depth and offset in percent. Left out means off. */
  am?: ModRequest
  /** Frequency modulation, also used for sweeps. */
  fm?: ModRequest
}
export interface ModRequest {
  func: WaveRequest['func']
  frequency: number
  amplitude: number
  offset: number
  phase: number
  /** Custom modulator samples, −1 to 1 (func is then ignored). */
  data?: number[]
}

export interface SupplyRequest {
  master: boolean
  pos: { on: boolean; volts: number }
  neg: { on: boolean; volts: number }
}
export interface Monitor {
  pos: { volts: number; amps: number }
  neg: { volts: number; amps: number }
  usb: { volts: number; amps: number }
  temperature: number
}

export const HW = {
  status: 'hw:status',
  devices: 'hw:devices',
  open: 'hw:open',
  close: 'hw:close',
  scope: 'hw:scope',
  wavegen: 'hw:wavegen',
  wavegenStop: 'hw:wavegen-stop',
  supplies: 'hw:supplies',
  monitor: 'hw:monitor',
  dioWrite: 'hw:dio-write',
  dioRead: 'hw:dio-read'
} as const

export interface HwApi {
  status(): Promise<HwStatus>
  devices(): Promise<HwDevice[]>
  open(key: string, config: number): Promise<void>
  close(): Promise<void>
  scope(r: ScopeRequest): Promise<ScopeReply>
  wavegen(channel: number, w: WaveRequest): Promise<void>
  wavegenStop(channel: number): Promise<void>
  supplies(r: SupplyRequest): Promise<void>
  monitor(): Promise<Monitor>
  dioWrite(mask: number, value: number): Promise<void>
  dioRead(): Promise<number>
}
