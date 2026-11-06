// `npm run dev` runs the app inside node_modules/electron's Electron.app, so on macOS
// the menu bar, Dock and ⌘Tab show that bundle's name ("Electron"). Rename the dev
// bundle to Oscillo. Packaged builds get the name from electron-builder instead.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

if (process.platform === 'darwin') {
  const exe = createRequire(import.meta.url)('electron') // …/Electron.app/Contents/MacOS/Electron
  const plist = join(dirname(dirname(exe)), 'Info.plist')
  if (existsSync(plist)) {
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('plutil', ['-replace', key, '-string', 'Oscillo', plist])
    }
  }
}
