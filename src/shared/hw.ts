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
  /** 0 decimate, 1 average, 2 min/max, per channel. */
  filter?: Record<number, number>
  trigger?: {
    channel: number
    level: number
    slope: 'Rise' | 'Fall' | 'Either'
    position: number
    autoTimeout: number
    source?: number
    type?: number
    holdoff?: number
    hysteresis?: number
    filter?: number
    lengthCondition?: number
    length?: number
  }
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
  dioRead: 'hw:dio-read',
  logic: 'hw:logic',
  patterns: 'hw:patterns',
  patternsStop: 'hw:patterns-stop',
  protocol: 'hw:protocol',
  options: 'hw:options',
  dmm: 'hw:dmm'
} as const

export interface LogicRequest {
  rate: number
  samples: number
  /** DIO pins whose rising or falling edge triggers; none = capture at once. */
  trigger?: { rise: number[]; fall: number[]; position: number; autoTimeout: number }
}
export interface LogicReply {
  rate: number
  /** Bit n of each word is DIO n. */
  data: Uint16Array
}
export interface PatternRequest {
  pin: number
  kind: 'Clock' | 'Pulse' | 'Random' | 'Custom' | 'Constant'
  frequency: number
  duty?: number
  data?: number[]
  initHigh?: boolean
  idle?: 'Init' | 'Low' | 'High' | 'Z'
}

type Spi = { sck: number; mosi: number; miso: number; cs: number; frequency: number; mode?: number; msbFirst?: boolean }
/** Protocol master calls (UART, SPI, I²C, CAN from the SDK; JTAG, SWD and AVR built on top). */
export interface ProtocolCalls {
  uartSetup(u: { tx: number; rx: number; baud: number; bits?: number; parity?: number; stop?: number }): void
  uartSend(data: number[]): void
  uartReceive(max?: number): { data: number[]; parityError: boolean }
  spiSetup(s: Spi): void
  spiTransfer(tx: number[]): number[]
  i2cSetup(s: { scl: number; sda: number; rate: number }): void
  i2cTransfer(address: number, tx: number[], rxLength: number): { data: number[]; nak: number }
  canSetup(s: { tx: number; rx: number; rate: number }): void
  canSend(f: { id: number; extended: boolean; remote: boolean; data: number[] }): void
  canReceive(): { id: number; extended: boolean; remote: boolean; data: number[] } | null
  jtagSetup(p: { tck: number; tms: number; tdi: number; tdo: number }): void
  jtagReset(): void
  /** Value and result as hex strings. */
  jtagShift(reg: 'IR' | 'DR', len: number, hex: string): string
  jtagScan(): number[]
  swdSetup(p: { clk: number; io: number }): void
  swdConnect(): number
  swdTransfer(ap: boolean, read: boolean, addr: number, value?: number): number
  avrEnter(spi: Spi): number[]
  avrLeave(): void
  avrFuses(): { low: number; high: number; ext: number; lock: number }
  avrWriteFuses(f: { low: number; high: number; ext: number; lock: number }): void
  avrReadFlashWord(word: number): [number, number]
  avrReadEeprom(addr: number): number
  avrErase(): void
  /** Programs (or verifies) an Intel HEX file; returns the bytes written or checked. */
  avrProgram(path: string, chip: string): number
  avrVerify(path: string, chip: string): number
}
export const PROTOCOL_CALLS: (keyof ProtocolCalls)[] = ['uartSetup', 'uartSend', 'uartReceive', 'spiSetup', 'spiTransfer', 'i2cSetup', 'i2cTransfer', 'canSetup', 'canSend', 'canReceive', 'jtagSetup', 'jtagReset', 'jtagShift', 'jtagScan', 'swdSetup', 'swdConnect', 'swdTransfer', 'avrEnter', 'avrLeave', 'avrFuses', 'avrWriteFuses', 'avrReadFlashWord', 'avrReadEeprom', 'avrErase', 'avrProgram', 'avrVerify']

/** Device Options, applied to the open device. */
export interface OptionsRequest {
  /** 0 keep running, 1 stop outputs, 2 shut down. */
  onClose: 0 | 1 | 2
  keepUsb: boolean
  /** Amps. */
  usbLimit: number
  led: number
  audio: boolean
  sysFreq: number
  /** 0 internal, 1 output on Trigger 2, 2 external input. */
  clockMode: 0 | 1 | 2
  refFreq: number
  /** DIO bank, volts. */
  digitalVolts: number
  threshold: number
  driveMa: number
  slew: 0 | 1 | 2
  pull: 'None' | 'Up' | 'Down'
  /** TRIGSRC for each trigger pin; 0 makes it an input. */
  triggers: number[]
}
/** Which options the device took, and which it does not have. */
export interface OptionsReply {
  applied: string[]
  unsupported: string[]
}

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
  logic(r: LogicRequest): Promise<LogicReply>
  patterns(p: PatternRequest[]): Promise<void>
  patternsStop(): Promise<void>
  options(o: OptionsRequest): Promise<OptionsReply>
  /** One DMM reading (Analog Discovery Pro 5250). `mode` is DwfDmm*, `range` 0 for auto. Throws when the device has none. */
  dmm(mode: number, range: number): Promise<number>
  protocol<K extends keyof ProtocolCalls>(call: K, ...args: Parameters<ProtocolCalls[K]>): Promise<ReturnType<ProtocolCalls[K]>>
}
