// Programs Xilinx 7-series FPGAs (Artix-7, Spartan-7) over JTAG wired to the device's DIO pins,
// following the JTAG configuration flow in UG470: JPROGRAM, wait for INIT, CFG_IN with the
// bitstream, JSTART with idle clocks, then read DONE from the instruction capture.
import type { BitBang, Protocols } from './digital'

export const XILINX_7: Record<number, string> = {
  0x362e093: 'XC7A15T',
  0x362d093: 'XC7A35T',
  0x362c093: 'XC7A50T',
  0x3632093: 'XC7A75T',
  0x3631093: 'XC7A100T',
  0x3636093: 'XC7A200T',
  0x37c4093: 'XC7S25',
  0x362f093: 'XC7S50',
  0x37c8093: 'XC7S75',
  0x37c7093: 'XC7S100'
}
/** The part for an IDCODE, ignoring the silicon revision in the top four bits. */
export const xilinxPart = (id: number): string | null => XILINX_7[id & 0x0fffffff] ?? null

export interface Bitstream {
  design: string
  /** Part from the .bit header, e.g. 7a35tcpg236. */
  part: string
  date: string
  data: Uint8Array
}

/** Reads a .bit file (header plus data) or a raw .bin. */
export function parseBitstream(buf: Uint8Array, name = ''): Bitstream {
  const sync = (b: Uint8Array) => {
    for (let i = 0; i + 4 <= b.length; i++) if (b[i] === 0xaa && b[i + 1] === 0x99 && b[i + 2] === 0x55 && b[i + 3] === 0x66) return i
    return -1
  }
  if (/\.bin$/i.test(name) || buf[0] === 0xff) {
    if (sync(buf) < 0) throw new Error('This file has no 7-series sync word. Use a .bit or .bin from Vivado.')
    return { design: name, part: '', date: '', data: buf }
  }
  // .bit: a 2-byte length and field 0, then the 'a'..'e' fields; 'e' carries a 4-byte length and the data.
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let i = 2 + dv.getUint16(0)
  i += 2 // the 0x0001 that follows
  const text: Record<string, string> = {}
  while (i < buf.length) {
    const key = String.fromCharCode(buf[i++])
    if (key === 'e') {
      const n = dv.getUint32(i)
      i += 4
      if (i + n > buf.length) throw new Error('The bitstream is cut short')
      const data = buf.subarray(i, i + n)
      if (sync(data) < 0) throw new Error('This bitstream has no 7-series sync word')
      return { design: (text.a ?? '').split(';')[0], part: text.b ?? '', date: `${text.c ?? ''} ${text.d ?? ''}`.trim(), data }
    }
    if (!'abcd'.includes(key)) break
    const n = dv.getUint16(i)
    i += 2
    text[key] = new TextDecoder().decode(buf.subarray(i, i + n)).replace(/\0+$/, '')
    i += n
  }
  throw new Error('This is not a Xilinx .bit file')
}

const IR = { JPROGRAM: 0x0b, CFG_IN: 0x05, JSTART: 0x0c, BYPASS: 0x3f }
const IR_LEN = 6

export interface ProgramStep {
  phase: 'Connecting' | 'Clearing' | 'Programming' | 'Starting' | 'Done'
  /** Bytes sent so far, of `total`. */
  done: number
  total: number
}

/** Programs the only device on the chain. Returns its part name. Throws with a plain reason. */
export async function programXilinx(
  bb: BitBang,
  spi: Protocols,
  pins: { tck: number; tms: number; tdi: number; tdo: number },
  bit: Bitstream,
  opts: { hz?: number; progress?: (s: ProgramStep) => void } = {}
): Promise<string> {
  const total = bit.data.length
  const step = (phase: ProgramStep['phase'], done = 0) => opts.progress?.({ phase, done, total })
  step('Connecting')
  bb.jtagSetup(pins)
  const ids = bb.jtagScan()
  if (!ids.length) throw new Error('No JTAG device answered. Check the wiring and that the board is powered.')
  if (ids.length > 1) throw new Error(`Found ${ids.length} devices on the chain. Only a single 7-series FPGA is supported.`)
  const part = xilinxPart(ids[0])
  if (!part) throw new Error(`IDCODE 0x${ids[0].toString(16).toUpperCase().padStart(8, '0')} is not a supported Artix-7 or Spartan-7.`)
  const want = bit.part.replace(/^xc/i, '').match(/^7[as]\d+t?/i)?.[0]
  if (want && !part.toLowerCase().includes(want.toLowerCase())) throw new Error(`The bitstream is for ${bit.part}, but the board has an ${part}.`)

  bb.jtagReset()
  step('Clearing')
  bb.jtagShift('IR', IR_LEN, BigInt(IR.JPROGRAM))
  // Wait for INIT: the IR capture has INIT in bit 4 once the configuration memory is clear.
  let init = false
  for (let k = 0; k < 50 && !init; k++) {
    bb.jtagIdle(20)
    init = ((bb.jtagShift('IR', IR_LEN, BigInt(IR.BYPASS)) >> 4n) & 1n) === 1n
  }
  if (!init) throw new Error('The FPGA did not clear its configuration (INIT stayed low).')

  bb.jtagShift('IR', IR_LEN, BigInt(IR.CFG_IN))
  bb.jtagEnterShiftDR()
  step('Programming')
  await bb.jtagStream(spi, bit.data.subarray(0, total - 1), opts.hz ?? 4e6, (n) => step('Programming', n))
  bb.jtagShiftLastByte(bit.data[total - 1])

  step('Starting', total)
  bb.jtagShift('IR', IR_LEN, BigInt(IR.JSTART))
  await bb.jtagStream(spi, new Uint8Array(2000 / 8 + 8), opts.hz ?? 4e6)
  const cap = bb.jtagShift('IR', IR_LEN, BigInt(IR.BYPASS))
  bb.jtagReset()
  if (((cap >> 5n) & 1n) !== 1n) throw new Error('The bitstream was sent, but DONE stayed low. Check that it was built for this part.')
  step('Done', total)
  return part
}
