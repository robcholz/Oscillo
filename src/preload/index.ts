import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ThemePref } from '../shared/ipc'

const api = {
  platform: process.platform,
  setTheme: (theme: ThemePref): void => ipcRenderer.send(IPC.setTheme, theme)
}

contextBridge.exposeInMainWorld('oscillo', api)

export type OscilloApi = typeof api
