// The menu bar. Electron's default menu binds ⌘R to Reload, ⌘Z to the page's text undo and ⌘0 to
// Actual Size, which took those keys from the app's own shortcuts. This menu lists the app's
// commands with their shortcuts, as a Mac app should, and sends each one to the window.
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { COMMAND, type AppCommand } from '../shared/commands'

const send = (cmd: AppCommand) => (): void => (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send(COMMAND, cmd)
const item = (label: string, accelerator: string, cmd: AppCommand): MenuItemConstructorOptions => ({ label, accelerator, click: send(cmd) })

const plain = (label: string, cmd: AppCommand): MenuItemConstructorOptions => ({ label, click: send(cmd) })

const INSTRUMENTS: [string, string][] = [
  ['Scope', 'scope'],
  ['Wavegen', 'wavegen'],
  ['Supplies', 'supplies'],
  ['Logic', 'logic'],
  ['Spectrum', 'spectrum'],
  ['Script', 'script']
]

export function buildMenu(): void {
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [plain(`About ${app.name}`, 'about'), plain('Check for Updates…', 'check-updates'), { type: 'separator' }, item('Settings…', 'CmdOrCtrl+,', 'settings'), { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [item('Open Workspace…', 'CmdOrCtrl+O', 'open-workspace'), item('Save Workspace', 'CmdOrCtrl+S', 'save-workspace'), { type: 'separator' }, mac ? { role: 'close' } : { role: 'quit' }]
    },
    {
      // Undo and Redo go to the page: text fields undo their typing, the wave and pattern editors their edits.
      label: 'Edit',
      submenu: [item('Undo', 'CmdOrCtrl+Z', 'undo'), item('Redo', 'Shift+CmdOrCtrl+Z', 'redo'), { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },
    {
      label: 'View',
      submenu: [
        item('Command Menu', 'CmdOrCtrl+K', 'search'),
        { type: 'separator' },
        item('Toggle Sidebar', 'CmdOrCtrl+B', 'toggle-sidebar'),
        item('Show or Hide Settings Panel', 'Alt+CmdOrCtrl+0', 'toggle-panel'),
        item('Toggle Light and Dark', 'Shift+CmdOrCtrl+L', 'toggle-theme'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload', accelerator: 'Alt+CmdOrCtrl+R' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
      ]
    },
    {
      label: 'Instruments',
      submenu: [
        ...INSTRUMENTS.map(([label, id], i) => item(label, `CmdOrCtrl+${i + 1}`, `page:${id}`)),
        { type: 'separator' },
        item('Single Capture', 'CmdOrCtrl+Enter', 'single'),
        item('Auto Set', 'Shift+CmdOrCtrl+A', 'auto-set'),
        item('Run Script', 'CmdOrCtrl+R', 'run-script')
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        plain(`${app.name} Documentation`, 'docs'),
        plain('Keyboard Shortcuts', 'shortcuts'),
        { type: 'separator' },
        plain('Send Feedback…', 'feedback'),
        plain('Report an Issue…', 'report-issue'),
        ...(mac ? [] : [{ type: 'separator' }, plain(`About ${app.name}`, 'about'), plain('Check for Updates…', 'check-updates')] as MenuItemConstructorOptions[])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
