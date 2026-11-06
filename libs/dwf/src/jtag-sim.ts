// A simulated Xilinx 7-series FPGA (XC7A35T) on a JTAG chain, for the simulator: a full TAP state
// machine with IDCODE, BYPASS, JPROGRAM, CFG_IN and JSTART, so the FPGA programmer can be exercised
// without hardware. Configuration "succeeds" when the data holds the sync word and JSTART is clocked.

// TAP states, IEEE 1149.1.
const enum S { Reset, Idle, SelDR, CapDR, ShDR, Ex1DR, PauseDR, Ex2DR, UpdDR, SelIR, CapIR, ShIR, Ex1IR, PauseIR, Ex2IR, UpdIR }
const NEXT: [S, S][] = [
  [S.Idle, S.Reset], [S.Idle, S.SelDR], [S.CapDR, S.SelIR], [S.ShDR, S.Ex1DR], [S.ShDR, S.Ex1DR], [S.PauseDR, S.UpdDR], [S.PauseDR, S.Ex2DR], [S.ShDR, S.UpdDR],
  [S.Idle, S.SelDR], [S.CapIR, S.Reset], [S.ShIR, S.Ex1IR], [S.ShIR, S.Ex1IR], [S.PauseIR, S.UpdIR], [S.PauseIR, S.Ex2IR], [S.ShIR, S.UpdIR], [S.Idle, S.SelDR]
]

export const SIM_IDCODE = 0x0362d093
const IR_LEN = 6
const I = { IDCODE: 0x09, BYPASS: 0x3f, JPROGRAM: 0x0b, CFG_IN: 0x05, JSTART: 0x0c }

export class SimTap {
  private st = S.Reset
  private ir = I.IDCODE
  private irSr = 0
  private dr = 0n
  private drLen = 1
  /** CFG_IN: the last 32 bits, whether the sync word went by, and the bytes received (MSB first). */
  private win = 0
  private synced = false
  private bits = 0
  private bytes: number[] = []
  private byte = 0
  private init = 1
  private done = 0
  private idleSinceProgram = 0
  private idleSinceStart = 0
  private started = false
  tdo = 0

  /** One rising TCK edge with these TMS and TDI levels. */
  clock(tms: number, tdi: number): void {
    const s = this.st
    if (s === S.ShDR) {
      if (this.ir === I.CFG_IN) this.cfgBit(tdi)
      this.dr = (this.dr >> 1n) | (BigInt(tdi) << BigInt(this.drLen - 1))
    } else if (s === S.ShIR) this.irSr = (this.irSr >> 1) | (tdi << (IR_LEN - 1))
    if (s === S.Idle) {
      if (!this.init && ++this.idleSinceProgram > 100) this.init = 1
      if (this.started && ++this.idleSinceStart >= 2000) this.done = this.synced ? 1 : 0
    }
    const n = NEXT[s][tms ? 1 : 0]
    this.enter(n)
    this.st = n
    this.tdo = n === S.ShDR ? Number(this.dr & 1n) : n === S.ShIR ? this.irSr & 1 : 0
  }

  private enter(n: S): void {
    if (n === S.Reset) this.ir = I.IDCODE
    if (n === S.CapIR) this.irSr = (this.done << 5) | (this.init << 4) | 0b0001
    if (n === S.UpdIR) {
      this.ir = this.irSr & ((1 << IR_LEN) - 1)
      if (this.ir === I.JPROGRAM) {
        this.init = 0
        this.done = 0
        this.started = false
        this.idleSinceProgram = 0
        this.win = 0
        this.synced = false
        this.bits = 0
        this.bytes = []
      }
      if (this.ir === I.JSTART) {
        this.started = true
        this.idleSinceStart = 0
      }
    }
    if (n === S.CapDR) {
      if (this.ir === I.IDCODE) [this.dr, this.drLen] = [BigInt(SIM_IDCODE), 32]
      else [this.dr, this.drLen] = [0n, 1]
    }
  }

  private cfgBit(b: number): void {
    this.win = ((this.win << 1) | b) >>> 0
    if (this.win === 0xaa995566) this.synced = true
    this.byte = ((this.byte << 1) | b) & 0xff
    if (++this.bits % 8 === 0) this.bytes.push(this.byte)
  }

  /** Bytes the FPGA received through CFG_IN (MSB first), for tests. */
  received(): number[] {
    return this.bytes
  }

  /** Whether the FPGA is configured (DONE high). */
  get isDone(): boolean {
    return this.done === 1
  }
}
