import { contextBridge, ipcRenderer } from 'electron'
import { HW, type HwApi } from '../shared/hw'
import { IPC, type ThemePref } from '../shared/ipc'

const invoke =
  (ch: string) =>
  (...a: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(ch, ...a)

/** Device and instrument calls, served by the main process (src/main/hardware.ts). */
const hw = Object.fromEntries(Object.entries(HW).map(([k, ch]) => [k, invoke(ch)])) as unknown as HwApi

const api = {
  platform: process.platform,
  setTheme: (theme: ThemePref): void => ipcRenderer.send(IPC.setTheme, theme),
  hw
}

contextBridge.exposeInMainWorld('oscillo', api)

export type OscilloApi = typeof api
