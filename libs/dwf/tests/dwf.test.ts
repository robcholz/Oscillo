import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Dwf, DwfError, createSimDwf, dwf, findLibrary, loadDwf } from '../src'

const header = readFileSync(join(__dirname, '../include/dwf.h'), 'utf8')

describe('generated bindings', () => {
  it('cover every function and constant in dwf.h', () => {
    const fns = [...header.matchAll(/^DWFAPI\s+\w+\s+(\w+)\s*\(/gm)].map((m) => m[1])
    expect(dwf.PROTOTYPES.map((p) => /\s(\w+)\(/.exec(p)![1])).toEqual(fns)
    expect(dwf.devidDiscovery3).toBe(10)
    expect(dwf.funcSine).toBe(1)
    expect(dwf.DwfStateDone).toBe(2)
  })

  it('parse as C prototypes in koffi', () => {
    const koffi = createRequire(import.meta.url)('koffi')
    for (const [name, base] of Object.entries(dwf.TYPEDEFS)) {
      try {
        koffi.alias(name, base)
      } catch {
        // Already declared by the loader in this process.
      }
    }
    for (const p of dwf.PROTOTYPES) expect(() => koffi.proto(p.replace(/ (\w+)\(/, ' $1_t(')), p).not.toThrow()
  })
})

describe('simulated Analog Discovery 3', () => {
  const sim = (): Dwf => new Dwf(createSimDwf({ noise: 0 }))

  it('enumerates the device and its buffer configurations', () => {
    const [d, ...rest] = sim().devices()
    expect(rest).toHaveLength(0)
    expect(d).toMatchObject({ name: 'Analog Discovery 3', serial: '210415BB1C2D', id: dwf.devidDiscovery3, opened: false })
    expect(d.configs).toHaveLength(4)
    expect(d.configs[0]).toMatchObject({ analogInChannels: 2, analogInBuffer: 32768, digitalIOChannels: 16 })
  })

  it('refuses a second open and reports the SDK error', () => {
    const d = sim()
    const dev = d.open(0)
    expect(() => d.open(0)).toThrow(DwfError)
    try {
      d.open(0)
    } catch (e) {
      expect((e as DwfError).code).toBe(dwf.dwfercAlreadyOpened)
      expect((e as DwfError).message).toContain('already opened')
    }
    dev.close()
    expect(() => d.open(0).close()).not.toThrow()
  })

  it('captures a triggered sine from the wavegen loopback', async () => {
    const dev = sim().open(0)
    dev.wavegen.set(0, { func: 'Sine', frequency: 1e3, amplitude: 2, offset: 0.5 })
    dev.wavegen.start(0)
    expect(dev.wavegen.running(0)).toBe(true)
    const { rate, data } = await dev.scope.single({ channels: [0], rate: 1e6, samples: 2000, trigger: { channel: 0, level: 0.5, slope: 'Rise' } })
    expect(rate).toBe(1e6)
    const y = data[0]
    expect(Math.max(...y)).toBeCloseTo(2.5, 2)
    expect(Math.min(...y)).toBeCloseTo(-1.5, 2)
    // The rising crossing of 0.5 V sits at the centre of the record.
    expect(y[999]).toBeLessThan(0.5)
    expect(y[1001]).toBeGreaterThan(0.5)
    dev.close()
  })

  it('clips to the channel range', async () => {
    const dev = sim().open(0)
    dev.wavegen.set(1, { func: 'Square', frequency: 500, amplitude: 4 })
    dev.wavegen.start(1)
    const { data } = await dev.scope.single({ channels: [1], rate: 1e5, samples: 400, setup: { 1: { range: 5 } } })
    expect(Math.max(...data[0])).toBeCloseTo(2.5)
    expect(Math.min(...data[0])).toBeCloseTo(-2.5)
    dev.close()
  })

  it('drives the supplies and reads the monitors', () => {
    const dev = sim().open(0)
    const ch = dev.io.channels()
    expect(ch.map((c) => c.label)).toEqual(['V+', 'V-', 'USB'])
    expect(ch[0].nodes.map((n) => `${n.name} ${n.units}`.trim())).toEqual(['Enable', 'Voltage V', 'Current A'])
    dev.io.set(0, 1, 3.3)
    dev.io.set(0, 0, 1)
    expect(dev.io.read([[0, 1]])[0]).toBe(0)
    dev.io.enable(true)
    const [v, usb] = dev.io.read([
      [0, 1],
      [2, 0]
    ])
    expect(v).toBeCloseTo(3.3)
    expect(usb).toBeGreaterThan(4.5)
    expect(() => dev.io.set(2, 0, 1)).toThrow(/read-only/)
    dev.close()
  })

  it('reads back driven DIO pins', () => {
    const dev = sim().open(0)
    expect(dev.dio.outputMask()).toBe(0xffff)
    dev.dio.write(0x00ff, 0x00a5)
    expect(dev.dio.read() & 0xff).toBe(0xa5)
    dev.close()
  })

  it('high-passes wavegen 1 into scope 2 through the board RC (corner 1.59 kHz)', async () => {
    const dev = sim().open(0)
    const gain = async (f: number): Promise<number> => {
      dev.wavegen.set(0, { func: 'Sine', frequency: f, amplitude: 1 })
      dev.wavegen.start(0)
      const { data } = await dev.scope.single({ channels: [0, 1], rate: f * 100, samples: 2000 })
      return (Math.max(...data[1]) - Math.min(...data[1])) / (Math.max(...data[0]) - Math.min(...data[0]))
    }
    expect(await gain(1 / (2 * Math.PI * 1e-4))).toBeCloseTo(Math.SQRT1_2, 2)
    expect(await gain(100)).toBeLessThan(0.07)
    expect(await gain(100e3)).toBeGreaterThan(0.99)
    dev.close()
  })

  it('records the board microcontroller on the logic analyzer, triggered on CS', async () => {
    const dev = sim().open(0)
    const { rate, data } = await dev.logic.single({ rate: 100e6, samples: 16384, trigger: { rise: [], fall: [3], position: 0.01, autoTimeout: 0 } })
    expect(rate).toBe(100e6)
    const at = Math.round(16384 * 0.01)
    expect((data[at - 1] >> 3) & 1).toBe(1)
    expect((data[at] >> 3) & 1).toBe(0)
    // 32 SCK rising edges while CS is low.
    let rises = 0
    for (let i = 1; i < data.length; i++) if (data[i] & 1 && !(data[i - 1] & 1) && !(data[i] & 8)) rises++
    expect(rises).toBe(32)
    dev.close()
  })

  it('plays patterns that the logic analyzer reads back', async () => {
    const dev = sim().open(0)
    dev.patterns.start([{ pin: 7, kind: 'Clock', frequency: 1e6, duty: 25 }])
    const { data } = await dev.logic.single({ rate: 100e6, samples: 1000 })
    const high = data.reduce((n, w) => n + ((w >> 7) & 1), 0)
    expect(high).toBe(250)
    dev.patterns.stop()
    dev.close()
  })

  it('answers the protocol masters', () => {
    const dev = sim().open(0)
    const p = dev.protocols
    p.uartSetup({ tx: 4, rx: 5, baud: 115200 })
    p.uartSend([0x68, 0x69])
    expect(p.uartReceive().data).toEqual([0x68, 0x69])
    p.i2cSetup({ scl: 6, sda: 7, rate: 100e3 })
    expect(p.i2cTransfer(0x50, [0x10, 1, 2, 3], 0).nak).toBe(0)
    expect(p.i2cTransfer(0x50, [0x10], 3).data).toEqual([1, 2, 3])
    const t = p.i2cTransfer(0x48, [0], 2).data
    expect(((t[0] << 4) | (t[1] >> 4)) * 0.0625).toBeCloseTo(23.5, 0)
    expect(p.i2cTransfer(0x21, [0], 1).nak).not.toBe(0)
    p.canSetup({ tx: 8, rx: 9, rate: 500e3 })
    p.canSend({ id: 0x120, extended: false, remote: false, data: [1, 2] })
    expect(p.canReceive()).toEqual({ id: 0x121, extended: false, remote: false, data: [1, 2] })
    expect(p.canReceive()).toBeNull()
    dev.close()
  })

  it('fails unmodelled functions as not supported', () => {
    const raw = createSimDwf()
    expect(raw.FDwfAnalogImpedanceReset(1)).toBe(0)
    const code = new Int32Array(1)
    raw.FDwfGetLastError(code)
    expect(code[0]).toBe(dwf.dwfercNotSupported)
  })
})

// Runs only where WaveForms is installed, against the real library.
describe.runIf(!!findLibrary())('installed WaveForms SDK', () => {
  it('loads and reports its version', () => {
    expect(new Dwf(loadDwf()).version()).toMatch(/^\d+\.\d+/)
  })
})
