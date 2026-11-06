import { contextBridge, ipcRenderer } from 'electron'
import { HW, type HwApi } from '../shared/hw'
import { IPC, type ThemePref } from '../shared/ipc'
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
  onEvent: (fn) => {
    const h = (_e: unknown, ev: ScriptEvent) => fn(ev)
    ipcRenderer.on(SCRIPT.event, h)
    return () => ipcRenderer.removeListener(SCRIPT.event, h)
  }
}

const api = {
  platform: process.platform,
  setTheme: (theme: ThemePref): void => ipcRenderer.send(IPC.setTheme, theme),
  hw,
  script
}

contextBridge.exposeInMainWorld('oscillo', api)

export type OscilloApi = typeof api
