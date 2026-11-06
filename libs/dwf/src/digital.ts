// Digital instruments: Logic Analyzer (DigitalIn), Pattern Generator (DigitalOut) and the protocol
// masters (UART, SPI, I²C, CAN) that the SDK runs on the DIO pins.
import { DwfError, call, dbl } from './device'
import * as C from './generated'
import type { DwfRaw } from './generated'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const bits = (pins: number[]) => pins.reduce((m, p) => m | (1 << p), 0) >>> 0

export interface LogicCapture {
  /** Sample rate actually used. */
  rate: number
  /** One 16-bit word per sample, bit n = DIO n. */
  data: Uint16Array
}

export class LogicIn {
  constructor(
    private raw: DwfRaw,
    private h: number
  ) {}

  /** Largest number of samples one capture can hold. */
  bufferMax(): number {
    const n = new Int32Array(1)
    call(this.raw, 'FDwfDigitalInBufferSizeInfo', this.h, n)
    return n[0]
  }

  /**
   * One capture. With `trigger`, waits for any rising pin in `rise` or falling pin in `fall`, keeping
   * `position` (0–1) of the record before it; `autoTimeout` seconds (0 = wait forever) captures anyway.
   */
  async single(o: { rate: number; samples: number; trigger?: { rise: number[]; fall: number[]; position: number; autoTimeout: number }; timeout?: number }): Promise<LogicCapture> {
    const { raw, h } = this
    const samples = Math.min(o.samples, this.bufferMax())
    const clock = dbl(raw, 'FDwfDigitalInInternalClockInfo', h)
    const div = Math.max(1, Math.round(clock / o.rate))
    call(raw, 'FDwfDigitalInAcquisitionModeSet', h, C.acqmodeSingle)
    call(raw, 'FDwfDigitalInDividerSet', h, div)
    call(raw, 'FDwfDigitalInSampleFormatSet', h, 16)
    call(raw, 'FDwfDigitalInBufferSizeSet', h, samples)
    const t = o.trigger
    if (t && (t.rise.length || t.fall.length)) {
      call(raw, 'FDwfDigitalInTriggerSourceSet', h, C.trigsrcDetectorDigitalIn)
      call(raw, 'FDwfDigitalInTriggerSet', h, 0, 0, bits(t.rise), bits(t.fall))
      call(raw, 'FDwfDigitalInTriggerPositionSet', h, Math.round(samples * (1 - t.position)))
      call(raw, 'FDwfDigitalInTriggerAutoTimeoutSet', h, t.autoTimeout)
    } else {
      call(raw, 'FDwfDigitalInTriggerSourceSet', h, C.trigsrcNone)
      call(raw, 'FDwfDigitalInTriggerPositionSet', h, samples)
    }
    call(raw, 'FDwfDigitalInConfigure', h, 1, 1)
    const deadline = Date.now() + (o.timeout ?? 10_000)
    const sts = new Uint8Array(1)
    for (;;) {
      call(raw, 'FDwfDigitalInStatus', h, 1, sts)
      if (sts[0] === C.DwfStateDone) break
      if (Date.now() > deadline) {
        call(raw, 'FDwfDigitalInConfigure', h, 0, 0)
        throw new DwfError('FDwfDigitalInStatus', 0, 'acquisition timed out')
      }
      await sleep(2)
    }
    const data = new Uint16Array(samples)
    call(raw, 'FDwfDigitalInStatusData', h, data, samples * 2)
    return { rate: clock / div, data }
  }
}

export type PatternKind = 'Clock' | 'Pulse' | 'Random' | 'Custom' | 'Constant'

export interface Pattern {
  pin: number
  kind: PatternKind
  /** Clock and Pulse: frequency in Hz. Random: update rate. Custom: bit rate. */
  frequency: number
  /** Clock and Pulse: duty cycle, 0–100. */
  duty?: number
  /** Custom: the bits to play, first bit first. Constant: [level]. */
  data?: number[]
  /** Starts high. */
  initHigh?: boolean
  idle?: 'Init' | 'Low' | 'High' | 'Z'
}

const IDLE = { Init: C.DwfDigitalOutIdleInit, Low: C.DwfDigitalOutIdleLow, High: C.DwfDigitalOutIdleHigh, Z: C.DwfDigitalOutIdleZet }

export class PatternOut {
  constructor(
    private raw: DwfRaw,
    private h: number
  ) {}

  /** Plays the patterns on their pins (all others off), repeating until stopped. */
  start(patterns: Pattern[]): void {
    const { raw, h } = this
    call(raw, 'FDwfDigitalOutReset', h)
    const clock = dbl(raw, 'FDwfDigitalOutInternalClockInfo', h)
    for (const p of patterns) {
      call(raw, 'FDwfDigitalOutEnableSet', h, p.pin, 1)
      call(raw, 'FDwfDigitalOutIdleSet', h, p.pin, IDLE[p.idle ?? 'Init'])
      if (p.kind === 'Clock' || p.kind === 'Pulse') {
        // Counter of `total` ticks per period, split into low and high by the duty cycle.
        const total = Math.max(2, Math.round(clock / Math.max(1e-3, p.frequency)))
        const div = Math.max(1, Math.ceil(total / 32768))
        const ticks = Math.max(2, Math.round(total / div))
        const high = Math.max(1, Math.min(ticks - 1, Math.round((ticks * (p.duty ?? 50)) / 100)))
        call(raw, 'FDwfDigitalOutTypeSet', h, p.pin, C.DwfDigitalOutTypePulse)
        call(raw, 'FDwfDigitalOutDividerSet', h, p.pin, div)
        call(raw, 'FDwfDigitalOutCounterSet', h, p.pin, ticks - high, high)
        call(raw, 'FDwfDigitalOutCounterInitSet', h, p.pin, p.initHigh ? 1 : 0, 0)
      } else if (p.kind === 'Random') {
        call(raw, 'FDwfDigitalOutTypeSet', h, p.pin, C.DwfDigitalOutTypeRandom)
        call(raw, 'FDwfDigitalOutDividerSet', h, p.pin, Math.max(1, Math.round(clock / Math.max(1e-3, p.frequency))))
      } else if (p.kind === 'Constant') {
        call(raw, 'FDwfDigitalOutTypeSet', h, p.pin, C.DwfDigitalOutTypePulse)
        call(raw, 'FDwfDigitalOutDividerSet', h, p.pin, 1)
        call(raw, 'FDwfDigitalOutCounterSet', h, p.pin, 0, 0)
        call(raw, 'FDwfDigitalOutCounterInitSet', h, p.pin, p.data?.[0] ? 1 : 0, 0)
      } else {
        const d = p.data?.length ? p.data : [0]
        const buf = new Uint8Array(Math.ceil(d.length / 8))
        d.forEach((b, i) => b && (buf[i >> 3] |= 1 << (i & 7)))
        call(raw, 'FDwfDigitalOutTypeSet', h, p.pin, C.DwfDigitalOutTypeCustom)
        call(raw, 'FDwfDigitalOutDividerSet', h, p.pin, Math.max(1, Math.round(clock / Math.max(1e-3, p.frequency))))
        call(raw, 'FDwfDigitalOutDataSet', h, p.pin, buf, d.length)
      }
    }
    call(raw, 'FDwfDigitalOutRepeatSet', h, 0)
    call(raw, 'FDwfDigitalOutConfigure', h, 1)
  }

  stop(): void {
    call(this.raw, 'FDwfDigitalOutConfigure', this.h, 0)
    call(this.raw, 'FDwfDigitalOutReset', this.h)
  }
}

export interface UartSetup {
  tx: number
  rx: number
  baud: number
  bits?: number
  /** 0 none, 1 odd, 2 even. */
  parity?: number
  stop?: number
}
export interface SpiSetup {
  sck: number
  mosi: number
  miso: number
  cs: number
  frequency: number
  mode?: number
  msbFirst?: boolean
}
export interface I2cSetup {
  scl: number
  sda: number
  rate: number
}
export interface CanSetup {
  tx: number
  rx: number
  rate: number
}
export interface CanFrame {
  id: number
  extended: boolean
  remote: boolean
  data: number[]
}

/** Protocol masters on the DIO pins. Each `setup` resets that protocol. */
export class Protocols {
  constructor(
    private raw: DwfRaw,
    private h: number
  ) {}

  uartSetup(u: UartSetup): void {
    const { raw, h } = this
    call(raw, 'FDwfDigitalUartReset', h)
    call(raw, 'FDwfDigitalUartRateSet', h, u.baud)
    call(raw, 'FDwfDigitalUartBitsSet', h, u.bits ?? 8)
    call(raw, 'FDwfDigitalUartParitySet', h, u.parity ?? 0)
    call(raw, 'FDwfDigitalUartStopSet', h, u.stop ?? 1)
    call(raw, 'FDwfDigitalUartTxSet', h, u.tx)
    call(raw, 'FDwfDigitalUartRxSet', h, u.rx)
    // A zero-length receive starts the receiver.
    call(raw, 'FDwfDigitalUartRx', h, Buffer.alloc(1), 0, new Int32Array(1), new Int32Array(1))
  }

  uartSend(data: number[]): void {
    const b = Buffer.from(data)
    call(this.raw, 'FDwfDigitalUartTx', this.h, b, b.length)
  }

  /** Bytes received since the last call, and whether any had a parity error. */
  uartReceive(max = 4096): { data: number[]; parityError: boolean } {
    const b = Buffer.alloc(max)
    const n = new Int32Array(1)
    const p = new Int32Array(1)
    call(this.raw, 'FDwfDigitalUartRx', this.h, b, max, n, p)
    return { data: [...b.subarray(0, n[0])], parityError: p[0] !== 0 }
  }

  spiSetup(s: SpiSetup): void {
    const { raw, h } = this
    call(raw, 'FDwfDigitalSpiReset', h)
    call(raw, 'FDwfDigitalSpiFrequencySet', h, s.frequency)
    call(raw, 'FDwfDigitalSpiClockSet', h, s.sck)
    call(raw, 'FDwfDigitalSpiDataSet', h, 0, s.mosi)
    call(raw, 'FDwfDigitalSpiDataSet', h, 1, s.miso)
    call(raw, 'FDwfDigitalSpiModeSet', h, s.mode ?? 0)
    call(raw, 'FDwfDigitalSpiOrderSet', h, s.msbFirst === false ? 0 : 1)
    call(raw, 'FDwfDigitalSpiSelectSet', h, s.cs, 1)
    this.cs = s.cs
  }
  private cs = 0

  /** Selects, writes `tx` while reading as many bytes, and deselects (unless `hold`). */
  spiTransfer(tx: number[], hold = false): number[] {
    const { raw, h } = this
    const t = Uint8Array.from(tx.length ? tx : [0])
    const r = new Uint8Array(t.length)
    call(raw, 'FDwfDigitalSpiSelect', h, this.cs, 0)
    if (tx.length) call(raw, 'FDwfDigitalSpiWriteRead', h, 1, 8, t, tx.length, r, tx.length)
    if (!hold) call(raw, 'FDwfDigitalSpiSelect', h, this.cs, 1)
    return [...r.subarray(0, tx.length)]
  }

  spiRelease(): void {
    call(this.raw, 'FDwfDigitalSpiSelect', this.h, this.cs, 1)
  }

  i2cSetup(s: I2cSetup): void {
    const { raw, h } = this
    call(raw, 'FDwfDigitalI2cReset', h)
    call(raw, 'FDwfDigitalI2cStretchSet', h, 1)
    call(raw, 'FDwfDigitalI2cRateSet', h, s.rate)
    call(raw, 'FDwfDigitalI2cSclSet', h, s.scl)
    call(raw, 'FDwfDigitalI2cSdaSet', h, s.sda)
    const free = new Int32Array(1)
    call(raw, 'FDwfDigitalI2cClear', h, free)
    if (!free[0]) throw new DwfError('FDwfDigitalI2cClear', 0, 'I²C bus is held low. Check the pull-ups and wiring.')
  }

  /** Writes then reads at a 7-bit address. `nak` is 0 when every byte was acknowledged. */
  i2cTransfer(address: number, tx: number[], rxLength: number): { data: number[]; nak: number } {
    const { raw, h } = this
    const t = Uint8Array.from(tx.length ? tx : [0])
    const r = new Uint8Array(Math.max(1, rxLength))
    const nak = new Int32Array(1)
    const adr = (address << 1) & 0xff
    if (rxLength && tx.length) call(raw, 'FDwfDigitalI2cWriteRead', h, adr, t, tx.length, r, rxLength, nak)
    else if (rxLength) call(raw, 'FDwfDigitalI2cRead', h, adr, r, rxLength, nak)
    else call(raw, 'FDwfDigitalI2cWrite', h, adr, t, tx.length, nak)
    return { data: rxLength ? [...r.subarray(0, rxLength)] : [], nak: nak[0] }
  }

  canSetup(s: CanSetup): void {
    const { raw, h } = this
    call(raw, 'FDwfDigitalCanReset', h)
    call(raw, 'FDwfDigitalCanRateSet', h, s.rate)
    call(raw, 'FDwfDigitalCanPolaritySet', h, 0)
    call(raw, 'FDwfDigitalCanTxSet', h, s.tx)
    call(raw, 'FDwfDigitalCanRxSet', h, s.rx)
    // A first receive starts the receiver.
    this.canReceive()
  }

  canSend(f: CanFrame): void {
    const d = Uint8Array.from(f.data.slice(0, 8))
    call(this.raw, 'FDwfDigitalCanTx', this.h, f.id, f.extended ? 1 : 0, f.remote ? 1 : 0, d.length, d.length ? d : new Uint8Array(1))
  }

  /** The next received frame, or null when none is waiting. */
  canReceive(): CanFrame | null {
    const id = new Int32Array(1)
    const ext = new Int32Array(1)
    const rem = new Int32Array(1)
    const dlc = new Int32Array(1)
    const st = new Int32Array(1)
    const d = new Uint8Array(8)
    call(this.raw, 'FDwfDigitalCanRx', this.h, id, ext, rem, dlc, d, 8, st)
    if (st[0] === 0) return null
    return { id: id[0], extended: !!ext[0], remote: !!rem[0], data: [...d.subarray(0, dlc[0])] }
  }
}

/**
 * JTAG and SWD by bit-banging DIO pins through Static I/O. Slow (one USB transfer per edge) but
 * enough to scan a chain, shift registers and read debug-port registers.
 */
export class BitBang {
  private out = 0
  private oe = 0
  constructor(
    private raw: DwfRaw,
    private h: number
  ) {}

  private apply(): void {
    call(this.raw, 'FDwfDigitalIOOutputEnableSet', this.h, this.oe >>> 0)
    call(this.raw, 'FDwfDigitalIOOutputSet', this.h, this.out >>> 0)
    call(this.raw, 'FDwfDigitalIOConfigure', this.h)
  }
  private set(pin: number, v: number | boolean): void {
    this.out = v ? this.out | (1 << pin) : this.out & ~(1 << pin)
  }
  private drive(pin: number, on: boolean): void {
    this.oe = on ? this.oe | (1 << pin) : this.oe & ~(1 << pin)
  }
  private read(pin: number): number {
    const v = new Uint32Array(1)
    call(this.raw, 'FDwfDigitalIOStatus', this.h)
    call(this.raw, 'FDwfDigitalIOInputStatus', this.h, v)
    return (v[0] >> pin) & 1
  }

  // JTAG
  private j = { tck: 0, tms: 1, tdi: 2, tdo: 3 }
  jtagSetup(p: { tck: number; tms: number; tdi: number; tdo: number }): void {
    this.j = p
    this.oe = (1 << p.tck) | (1 << p.tms) | (1 << p.tdi)
    this.out = 0
    this.apply()
  }
  /** One TCK cycle; returns TDO sampled before the rising edge. */
  private tick(tms: number, tdi = 0): number {
    const { tck } = this.j
    this.set(this.j.tms, tms)
    this.set(this.j.tdi, tdi)
    this.set(tck, 0)
    this.apply()
    const tdo = this.read(this.j.tdo)
    this.set(tck, 1)
    this.apply()
    return tdo
  }
  /** Test-Logic-Reset, then Run-Test/Idle. */
  jtagReset(): void {
    for (let i = 0; i < 6; i++) this.tick(1)
    this.tick(0)
  }
  /** Shifts `len` bits of `value` (LSB first) through IR or DR from Run-Test/Idle, back to Idle. */
  jtagShift(reg: 'IR' | 'DR', len: number, value: bigint): bigint {
    for (const t of reg === 'IR' ? [1, 1, 0, 0] : [1, 0, 0]) this.tick(t)
    let out = 0n
    for (let i = 0; i < len; i++) {
      const last = i === len - 1
      out |= BigInt(this.tick(last ? 1 : 0, Number((value >> BigInt(i)) & 1n))) << BigInt(i)
    }
    this.tick(1)
    this.tick(0)
    return out
  }
  /** IDCODEs of the chain after reset, nearest TDO first (BYPASS devices read as 0). */
  jtagScan(max = 8): number[] {
    this.jtagReset()
    for (const t of [1, 0, 0]) this.tick(t)
    const ids: number[] = []
    for (let d = 0; d < max; d++) {
      if (this.tick(0, 1) === 0) {
        ids.push(0)
        continue
      }
      let id = 1
      for (let b = 1; b < 32; b++) id |= this.tick(0, 1) << b
      if (id >>> 0 === 0xffffffff) break
      ids.push(id >>> 0)
    }
    this.jtagReset()
    return ids
  }

  // SWD
  private s = { clk: 0, io: 1 }
  swdSetup(p: { clk: number; io: number }): void {
    this.s = p
    this.oe = (1 << p.clk) | (1 << p.io)
    this.out = 0
    this.apply()
  }
  private swClock(bit?: number): number {
    const { clk, io } = this.s
    if (bit !== undefined) this.set(io, bit)
    this.set(clk, 0)
    this.apply()
    const v = bit === undefined ? this.read(io) : 0
    this.set(clk, 1)
    this.apply()
    return v
  }
  private swWrite(v: number, n: number): void {
    this.drive(this.s.io, true)
    for (let i = 0; i < n; i++) this.swClock((v >> i) & 1)
  }
  private swRead(n: number): number {
    this.drive(this.s.io, false)
    let v = 0
    for (let i = 0; i < n; i++) v |= this.swClock() << i
    return v >>> 0
  }
  /** Line reset, the JTAG-to-SWD sequence, another reset and idle; returns DPIDR. */
  swdConnect(): number {
    for (let i = 0; i < 2; i++) this.swWrite(0xffffffff, 32)
    this.swWrite(0xe79e, 16)
    for (let i = 0; i < 2; i++) this.swWrite(0xffffffff, 32)
    this.swWrite(0, 8)
    return this.swdTransfer(false, true, 0)
  }
  private request(ap: boolean, read: boolean, addr: number): number {
    const a2 = (addr >> 2) & 1
    const a3 = (addr >> 3) & 1
    const par = (+ap + +read + a2 + a3) & 1
    return 1 | (+ap << 1) | (+read << 2) | (a2 << 3) | (a3 << 4) | (par << 5) | (0 << 6) | (1 << 7)
  }
  /** One read or write of a DP or AP register (addr 0x0, 0x4, 0x8, 0xC). Throws on a WAIT or FAULT. */
  swdTransfer(ap: boolean, read: boolean, addr: number, value = 0): number {
    this.swWrite(this.request(ap, read, addr), 8)
    this.swRead(1)
    const ack = this.swRead(3)
    if (ack !== 1) {
      this.swRead(1)
      this.swWrite(0, 8)
      throw new DwfError('SWD', ack, ack === 2 ? 'Target answered WAIT' : ack === 4 ? 'Target answered FAULT' : 'No answer from the target. Check SWCLK, SWDIO, power and ground.')
    }
    let v = value >>> 0
    if (read) {
      v = this.swRead(32)
      const par = this.swRead(1)
      this.swRead(1)
      let p = 0
      for (let i = 0; i < 32; i++) p ^= (v >> i) & 1
      if (p !== par) throw new DwfError('SWD', 0, 'Parity error in the read data')
    } else {
      this.swRead(1)
      let p = 0
      for (let i = 0; i < 32; i++) p ^= (v >> i) & 1
      this.swWrite(v, 32)
      this.swWrite(p, 1)
    }
    this.swWrite(0, 8)
    return v >>> 0
  }
}
