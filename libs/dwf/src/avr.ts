// AVR in-system programming over the SPI master, with RESET on the SPI select pin held low.
import type { Protocols } from './digital'

export interface AvrChip {
  name: string
  signature: number[]
  /** Flash page size in words. */
  pageWords: number
  flashBytes: number
}
export const AVR_CHIPS: Record<string, AvrChip> = {
  ATmega328P: { name: 'ATmega328P', signature: [0x1e, 0x95, 0x0f], pageWords: 64, flashBytes: 32768 },
  ATmega2560: { name: 'ATmega2560', signature: [0x1e, 0x98, 0x01], pageWords: 128, flashBytes: 262144 },
  ATmega32U4: { name: 'ATmega32U4', signature: [0x1e, 0x95, 0x87], pageWords: 64, flashBytes: 32768 },
  ATtiny85: { name: 'ATtiny85', signature: [0x1e, 0x93, 0x0b], pageWords: 32, flashBytes: 8192 },
  ATtiny13A: { name: 'ATtiny13A', signature: [0x1e, 0x90, 0x07], pageWords: 16, flashBytes: 1024 }
}

const wait = (ms: number) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* the SPI calls are synchronous too; a few ms of busy wait keeps the sequence simple */
  }
}

/** Parses Intel HEX into a flat image (0xFF where nothing is written). */
export function parseIntelHex(text: string, size: number): Uint8Array {
  const img = new Uint8Array(size).fill(0xff)
  let base = 0
  let top = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line[0] !== ':') throw new Error('Not an Intel HEX file')
    const b = line.slice(1).match(/../g)!.map((x) => parseInt(x, 16))
    const sum = b.reduce((a, x) => a + x, 0) & 0xff
    if (sum !== 0) throw new Error(`Checksum error in line ${line.slice(0, 16)}…`)
    const [n, hi, lo, type] = b
    const data = b.slice(4, 4 + n)
    if (type === 0) {
      const at = base + ((hi << 8) | lo)
      if (at + n > size) throw new Error('The image is larger than the chip flash')
      img.set(data, at)
      top = Math.max(top, at + n)
    } else if (type === 1) break
    else if (type === 2) base = ((data[0] << 8) | data[1]) << 4
    else if (type === 4) base = ((data[0] << 8) | data[1]) << 16
  }
  return img.subarray(0, top)
}

export class Avr {
  constructor(private spi: Protocols) {}

  private cmd(a: number, b: number, c: number, d = 0): number {
    return this.spi.spiTransfer([a, b, c, d], true)[3]
  }

  /** Holds RESET low, sends Programming Enable and returns the signature. */
  enter(): number[] {
    this.spi.spiRelease()
    wait(2)
    this.spi.spiTransfer([], true)
    wait(25)
    const echo = this.spi.spiTransfer([0xac, 0x53, 0, 0], true)[2]
    if (echo !== 0x53) throw new Error('The chip did not answer Programming Enable. Check RESET, SCK, MOSI, MISO and power.')
    return [0, 1, 2].map((i) => this.cmd(0x30, 0, i))
  }

  leave(): void {
    this.spi.spiRelease()
  }

  fuses(): { low: number; high: number; ext: number; lock: number } {
    return { low: this.cmd(0x50, 0, 0), high: this.cmd(0x58, 0x08, 0), ext: this.cmd(0x50, 0x08, 0), lock: this.cmd(0x58, 0, 0) }
  }

  writeFuses(f: { low: number; high: number; ext: number; lock: number }): void {
    this.cmd(0xac, 0xa0, 0, f.low)
    wait(5)
    this.cmd(0xac, 0xa8, 0, f.high)
    wait(5)
    this.cmd(0xac, 0xa4, 0, f.ext)
    wait(5)
    this.cmd(0xac, 0xe0, 0, f.lock)
    wait(5)
  }

  readFlashWord(word: number): [number, number] {
    return [this.cmd(0x20, word >> 8, word & 0xff), this.cmd(0x28, word >> 8, word & 0xff)]
  }

  readEeprom(addr: number): number {
    return this.cmd(0xa0, addr >> 8, addr & 0xff)
  }

  erase(): void {
    this.cmd(0xac, 0x80, 0)
    wait(15)
  }

  /** Erases, writes the image page by page and verifies it. Returns the bytes written. */
  program(img: Uint8Array, chip: AvrChip): number {
    this.erase()
    this.enter()
    const page = chip.pageWords * 2
    for (let at = 0; at < img.length; at += page) {
      for (let w = 0; w < chip.pageWords; w++) {
        const i = at + w * 2
        if (i >= img.length) break
        this.cmd(0x40, 0, w, img[i])
        this.cmd(0x48, 0, w, img[i + 1] ?? 0xff)
      }
      const word = at / 2
      this.cmd(0x4c, word >> 8, word & 0xff)
      wait(5)
    }
    this.verify(img)
    return img.length
  }

  /** Compares flash with the image; throws at the first difference. */
  verify(img: Uint8Array): number {
    for (let i = 0; i < img.length; i += 2) {
      const [lo, hi] = this.readFlashWord(i / 2)
      if (lo !== img[i] || (i + 1 < img.length && hi !== img[i + 1])) throw new Error(`Verify failed at 0x${i.toString(16).toUpperCase().padStart(4, '0')}`)
    }
    return img.length
  }
}
