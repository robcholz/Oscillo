// FPGA programming over JTAG on the device's DIO pins (src/main/fpga.ts).

export interface JtagPins {
  tck: number
  tms: number
  tdi: number
  tdo: number
}

/** What the header of a .bit (or a .bin) says. */
export interface BitInfo {
  path: string
  name: string
  design: string
  /** Part from the .bit header, e.g. 7a35tcpg236; empty for .bin. */
  part: string
  date: string
  bytes: number
}

export interface ChainDevice {
  /** IDCODE in hex, e.g. 0362D093. */
  idcode: string
  /** Supported part, or null. */
  part: string | null
}

export interface FpgaProgress {
  phase: 'Connecting' | 'Clearing' | 'Programming' | 'Starting' | 'Done'
  done: number
  total: number
}

export interface FpgaResult {
  part: string
  bytes: number
  ms: number
}

export const FPGA = {
  browse: 'fpga:browse',
  inspect: 'fpga:inspect',
  scan: 'fpga:scan',
  program: 'fpga:program',
  /** Main → renderer: programming progress. */
  progress: 'fpga:progress'
} as const

export interface FpgaApi {
  /** Picks a .bit or .bin and reads its header. Null when cancelled. */
  browse(): Promise<BitInfo | null>
  inspect(path: string): Promise<BitInfo>
  /** IDCODEs on the chain, nearest TDO first. */
  scan(pins: JtagPins): Promise<ChainDevice[]>
  /** Configures the FPGA's SRAM. Rejects with a plain reason. */
  program(pins: JtagPins, path: string, hz: number): Promise<FpgaResult>
  onProgress(fn: (p: FpgaProgress) => void): () => void
}
