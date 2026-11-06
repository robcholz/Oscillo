import { describe, expect, it } from 'vitest'
import { Dwf, SIM_IDCODE, SimTap, createSimDwf, parseBitstream, programXilinx, xilinxPart } from '../src'

const PINS = { tck: 0, tms: 1, tdi: 2, tdo: 3 }

/** A .bit file: header fields a-d, then 'e' with the data (dummy words, sync, payload). */
function bitFile(part: string, payload: number[]): Uint8Array {
  const data = [...new Array(16).fill(0xff), 0x00, 0x00, 0x00, 0xbb, 0x11, 0x22, 0x00, 0x44, 0xff, 0xff, 0xff, 0xff, 0xaa, 0x99, 0x55, 0x66, ...payload]
  const out: number[] = [0x00, 0x09, 0x0f, 0xf0, 0x0f, 0xf0, 0x0f, 0xf0, 0x0f, 0xf0, 0x00, 0x00, 0x01]
  const field = (k: string, v: string) => {
    const b = [...new TextEncoder().encode(v), 0]
    out.push(k.charCodeAt(0), b.length >> 8, b.length & 0xff, ...b)
  }
  field('a', 'blinky;UserID=0XFFFFFFFF')
  field('b', part)
  field('c', '2026/11/06')
  field('d', '12:00:00')
  const n = data.length
  out.push(0x65, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...data)
  return new Uint8Array(out)
}

const open = (tap: SimTap) => new Dwf(createSimDwf({ tap })).open(0)

describe('Xilinx 7-series over DIO JTAG', () => {
  it('parses a .bit header', () => {
    const b = parseBitstream(bitFile('7a35tcpg236', [1, 2, 3]), 'blinky.bit')
    expect(b).toMatchObject({ design: 'blinky', part: '7a35tcpg236', date: '2026/11/06 12:00:00' })
    expect([...b.data.subarray(-3)]).toEqual([1, 2, 3])
  })

  it('rejects files without a sync word', () => {
    expect(() => parseBitstream(new Uint8Array([0xff, 0xff, 0, 0]), 'x.bin')).toThrow(/sync word/)
  })

  it('scans the simulated chain', () => {
    const d = open(new SimTap())
    d.bitbang.jtagSetup(PINS)
    expect(d.bitbang.jtagScan()).toEqual([SIM_IDCODE])
    expect(xilinxPart(SIM_IDCODE)).toBe('XC7A35T')
    d.close()
  })

  it('programs the simulated XC7A35T and reads DONE', async () => {
    const tap = new SimTap()
    const d = open(tap)
    const payload = Array.from({ length: 40000 }, (_, i) => (i * 37) & 0xff)
    const bit = parseBitstream(bitFile('7a35tcpg236', payload), 'blinky.bit')
    const phases: string[] = []
    const part = await programXilinx(d.bitbang, d.protocols, PINS, bit, { progress: (s) => phases.at(-1) !== s.phase && phases.push(s.phase) })
    expect(part).toBe('XC7A35T')
    expect(phases).toEqual(['Connecting', 'Clearing', 'Programming', 'Starting', 'Done'])
    expect(tap.isDone).toBe(true)
    expect(tap.received()).toEqual([...bit.data])
    d.close()
  })

  it('refuses a bitstream for another part', async () => {
    const d = open(new SimTap())
    const bit = parseBitstream(bitFile('7a100tcsg324', [0]), 'big.bit')
    await expect(programXilinx(d.bitbang, d.protocols, PINS, bit)).rejects.toThrow(/XC7A35T/)
    d.close()
  })

  it('reports DONE low when the data has no sync word on the wire', async () => {
    const tap = new SimTap()
    const d = open(tap)
    const bit = { design: 'x', part: '', date: '', data: new Uint8Array(64).fill(0xff) }
    await expect(programXilinx(d.bitbang, d.protocols, PINS, bit)).rejects.toThrow(/DONE stayed low/)
    d.close()
  })
})
