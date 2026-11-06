import { contextBridge, ipcRenderer } from 'electron'
import { CAL, type CalApi } from '../shared/calibration'
import { COMMAND, type AppCommand } from '../shared/commands'
import { FILES, type FilesApi } from '../shared/files'
import { FPGA, type FpgaApi, type FpgaProgress } from '../shared/fpga'
import { HW, type HwApi } from '../shared/hw'
import { IPC, type ThemePref } from '../shared/ipc'
import { MCP, type McpApi, type McpEvent } from '../shared/mcp'
import { SCRIPT, type ScriptApi, type ScriptEvent } from '../shared/script'

const invoke =
  (ch: string) =>
  (...a: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(ch, ...a)

/** Device and instrument calls, served by the main process (src/main/hardware.ts). */
const hw = Object.fromEntries(Object.entries(HW).map(([k, ch]) => [k, invoke(ch)])) as unknown as HwApi

/** Script runs in the main process (src/main/script.ts); events stream back. */
const script: ScriptApi = {
  check: (files, file) => ipcRenderer.invoke(SCRIPT.check, files, file),
  run: (files, file, opts) => ipcRenderer.invoke(SCRIPT.run, files, file, opts),
  resume: (step) => ipcRenderer.invoke(SCRIPT.resume, step),
  stop: (abort) => ipcRenderer.invoke(SCRIPT.stop, abort),
  breakpoints: (bps) => ipcRenderer.invoke(SCRIPT.breakpoints, bps),
  folder: () => ipcRenderer.invoke(SCRIPT.folder),
  sync: (files) => ipcRenderer.invoke(SCRIPT.sync, files),
  onEvent: (fn) => {
    const h = (_e: unknown, ev: ScriptEvent) => fn(ev)
    ipcRenderer.on(SCRIPT.event, h)
    return () => ipcRenderer.removeListener(SCRIPT.event, h)
  }
}

/** The MCP server lives in the main process (src/main/mcp.ts). */
const mcp: McpApi = {
  settings: (st) => ipcRenderer.invoke(MCP.settings, st),
  resolve: (id, ok, session) => ipcRenderer.invoke(MCP.resolve, id, ok, session),
  disconnect: (c) => ipcRenderer.invoke(MCP.disconnect, c),
  onEvent: (fn) => {
    const h = (_e: unknown, ev: McpEvent) => fn(ev)
    ipcRenderer.on(MCP.event, h)
    return () => ipcRenderer.removeListener(MCP.event, h)
  }
}

/** File dialogs and writes (src/main/files.ts). */
const files = {
  ...(Object.fromEntries(Object.entries(FILES).map(([k, ch]) => [k, invoke(ch)])) as unknown as FilesApi),
  /** Workspace files opened from Finder or the command line. */
  onOpened: (fn: (path: string) => void) => {
    const h = (_e: unknown, p: string) => fn(p)
    ipcRenderer.on(FILES.opened, h)
    return () => void ipcRenderer.removeListener(FILES.opened, h)
  }
}

/** Calibration (src/main/calibration.ts). */
const calibration = Object.fromEntries(Object.entries(CAL).map(([k, ch]) => [k, invoke(ch)])) as unknown as CalApi

/** FPGA programming over DIO JTAG (src/main/fpga.ts). */
const fpga: FpgaApi = {
  browse: () => ipcRenderer.invoke(FPGA.browse),
  inspect: (path) => ipcRenderer.invoke(FPGA.inspect, path),
  scan: (pins) => ipcRenderer.invoke(FPGA.scan, pins),
  program: (pins, path, hz) => ipcRenderer.invoke(FPGA.program, pins, path, hz),
  onProgress: (fn) => {
    const h = (_e: unknown, p: FpgaProgress) => fn(p)
    ipcRenderer.on(FPGA.progress, h)
    return () => void ipcRenderer.removeListener(FPGA.progress, h)
  }
}

const api = {
  platform: process.platform,
  setTheme: (theme: ThemePref): void => ipcRenderer.send(IPC.setTheme, theme),
  /** Menu bar commands and their shortcuts (src/main/menu.ts). */
  onCommand: (fn: (cmd: AppCommand) => void): (() => void) => {
    const h = (_e: unknown, c: AppCommand) => fn(c)
    ipcRenderer.on(COMMAND, h)
    return () => void ipcRenderer.removeListener(COMMAND, h)
  },
  hw,
  script,
  mcp,
  files,
  calibration,
  fpga
}

contextBridge.exposeInMainWorld('oscillo', api)

export type OscilloApi = typeof api
