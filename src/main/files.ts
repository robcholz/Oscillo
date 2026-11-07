// File dialogs, writes and window captures for the renderer (Export, workspaces, logging, calibration).
import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { FILES, type Filter } from '../shared/files'

/** Where releases and issues live. */
export const REPO = 'robcholz/Oscillo'

const dataDir = (): string => join(app.getPath('userData'))
const full = (p: string): string => {
  const x = p.replace(/^~(?=\/|\\|$)/, homedir())
  return isAbsolute(x) ? x : resolve(dataDir(), x)
}
const bytes = (d: string | Uint8Array): string | Buffer => (typeof d === 'string' ? d : Buffer.from(d))

export function registerFiles(): void {
  ipcMain.handle(FILES.save, async (e, name: string, data: string | Uint8Array, filters?: Filter[], dir?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const start = full(dir ?? dataDir())
    mkdirSync(start, { recursive: true })
    const opts = { defaultPath: join(start, basename(name)), filters }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    mkdirSync(dirname(r.filePath), { recursive: true })
    writeFileSync(r.filePath, bytes(data))
    return r.filePath
  })
  ipcMain.handle(FILES.open, async (e, filters?: Filter[], binary?: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const opts = { defaultPath: dataDir(), filters, properties: ['openFile' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const path = r.filePaths[0]
    if (r.canceled || !path) return null
    const buf = readFileSync(path)
    return { path, name: basename(path), text: binary ? '' : buf.toString('utf8'), bytes: binary ? new Uint8Array(buf) : undefined }
  })
  ipcMain.handle(FILES.folder, async (e, start?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const opts = { defaultPath: start ? full(start) : dataDir(), properties: ['openDirectory' as const, 'createDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  ipcMain.handle(FILES.write, (_e, path: string, data: string | Uint8Array, append?: boolean) => {
    const p = full(path)
    mkdirSync(dirname(p), { recursive: true })
    if (append) appendFileSync(p, bytes(data))
    else writeFileSync(p, bytes(data))
    return p
  })
  ipcMain.handle(FILES.read, (_e, path: string) => readFileSync(full(path), 'utf8'))
  ipcMain.handle(FILES.mkdir, (_e, path: string) => {
    const p = full(path)
    mkdirSync(p, { recursive: true })
    return p
  })
  ipcMain.handle(FILES.reveal, (_e, path: string) => shell.showItemInFolder(full(path)))
  ipcMain.handle(FILES.capture, async (e) => new Uint8Array((await e.sender.capturePage()).toPNG()))
  ipcMain.handle(FILES.dataDir, () => dataDir())
  ipcMain.handle(FILES.version, () => ({ app: app.getVersion(), electron: process.versions.electron, exe: process.execPath }))
  ipcMain.handle(FILES.release, async () => {
    try {
      const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Oscillo' } })
      if (r.status === 404) return { error: 'No releases are published yet.' }
      if (!r.ok) return { error: `GitHub answered ${r.status}.` }
      const j = (await r.json()) as { tag_name: string; html_url: string }
      return { tag: j.tag_name, url: j.html_url }
    } catch {
      return { error: 'Could not reach GitHub. Check the network connection.' }
    }
  })
  ipcMain.handle(FILES.external, (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
}
