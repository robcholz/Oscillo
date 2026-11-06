import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { registerHardware } from './hardware'
import { registerMcp, stdioBridge } from './mcp'
import { registerScript, runCli } from './script'

/** background-100 of the theme showing, so a new or resized window never flashes the other one. */
const windowBackground = (): string => (nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff')

nativeTheme.on('updated', () => {
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(windowBackground())
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    // Collapsed sidebar + a plot that still reads + the settings panel; 56px title bar, toolbar,
    // status bar and a ~300px plot (see the layout notes in styles/app.css).
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: windowBackground(),
    title: 'Oscillo',
    titleBarStyle: 'hiddenInset',
    // Centred in the 56px title bar, 20px from the left edge.
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.on(IPC.setTheme, (_e, theme: unknown) => {
  nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system'
})

// `--mcp-stdio`: an MCP client launched the app as its stdio server. Relay to the running app.
const stdio = process.argv.includes('--mcp-stdio')
// `--script name.ts`: run a saved script without the window and print its console.
const scriptAt = process.argv.indexOf('--script')

if (stdio) {
  app.dock?.hide()
  void stdioBridge()
} else if (scriptAt > 0) {
  app.dock?.hide()
  void app.whenReady().then(async () => {
    const arg = (k: string) => process.argv[process.argv.indexOf(k) + 1]
    const code = await runCli(registerHardware(), process.argv[scriptAt + 1] ?? '', {
      timeout: process.argv.includes('--timeout') ? Number(arg('--timeout')) : 30,
      network: process.argv.includes('--allow-net'),
      anyPath: process.argv.includes('--allow-files') || process.argv.includes('--allow-net')
    })
    app.exit(code)
  })
} else
  app.whenReady().then(() => {
    const hw = registerHardware()
    registerMcp(hw, registerScript(hw))
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !stdio && scriptAt < 0) app.quit()
})
