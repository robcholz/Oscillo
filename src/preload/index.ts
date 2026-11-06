import { contextBridge, ipcRenderer } from 'electron'
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

const api = {
  platform: process.platform,
  setTheme: (theme: ThemePref): void => ipcRenderer.send(IPC.setTheme, theme),
  hw,
  script,
  mcp
}

contextBridge.exposeInMainWorld('oscillo', api)

export type OscilloApi = typeof api
