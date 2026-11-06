// Programs Xilinx 7-series FPGAs over JTAG wired to the open device's DIO pins.
// Experimental: verified against the simulator only.
import { parseBitstream, programXilinx, xilinxPart } from '@oscillo/dwf'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { FPGA, type BitInfo, type ChainDevice, type FpgaResult, type JtagPins } from '../shared/fpga'
import type { Hardware } from './hardware'

const full = (p: string): string => p.replace(/^~(?=\/|$)/, homedir())

function load(path: string) {
  const name = basename(path)
  const bit = parseBitstream(new Uint8Array(readFileSync(full(path))), name)
  const info: BitInfo = { path, name, design: bit.design || name, part: bit.part, date: bit.date, bytes: bit.data.length }
  return { bit, info }
}

function checkPins(p: JtagPins): void {
  const v = [p.tck, p.tms, p.tdi, p.tdo]
  if (v.some((x) => !Number.isInteger(x) || x < 0 || x > 31)) throw new Error('Pick a DIO pin for TCK, TMS, TDI and TDO')
  if (new Set(v).size !== 4) throw new Error('TCK, TMS, TDI and TDO need four different pins')
}

export function registerFpga(hw: Hardware): void {
  let busy = false
  const guard = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    if (busy) throw new Error('The FPGA is being programmed')
    busy = true
    try {
      return await fn()
    } finally {
      busy = false
    }
  }

  ipcMain.handle(FPGA.browse, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { filters: [{ name: 'Bitstream', extensions: ['bit', 'bin'] }], properties: ['openFile' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : load(r.filePaths[0]).info
  })
  ipcMain.handle(FPGA.inspect, (_e, path: string) => load(path).info)
  ipcMain.handle(FPGA.scan, (_e, pins: JtagPins) =>
    guard((): ChainDevice[] => {
      checkPins(pins)
      const b = hw.device().bitbang
      b.jtagSetup(pins)
      return b.jtagScan().map((id) => ({ idcode: (id >>> 0).toString(16).toUpperCase().padStart(8, '0'), part: xilinxPart(id) }))
    })
  )
  ipcMain.handle(FPGA.program, (e, pins: JtagPins, path: string, hz: number) =>
    guard(async (): Promise<FpgaResult> => {
      checkPins(pins)
      const d = hw.device()
      const { bit } = load(path)
      const t0 = Date.now()
      let last = 0
      const part = await programXilinx(d.bitbang, d.protocols, pins, bit, {
        hz,
        progress: (p) => {
          // Throttle to about 20 updates a second, but always send phase changes.
          const now = Date.now()
          if (p.phase === 'Programming' && p.done < p.total && now - last < 50) return
          last = now
          if (!e.sender.isDestroyed()) e.sender.send(FPGA.progress, p)
        }
      })
      return { part, bytes: bit.data.length, ms: Date.now() - t0 }
    })
  )
}
