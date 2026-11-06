// Smoke test for files, workspaces, calibration and device options on the Demo Device. Debug aid.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(execSync('npm root -g').toString().trim() + '/')
const { _electron: electron } = require('playwright')
const localRequire = createRequire(import.meta.url)
const profile = mkdtempSync(join(tmpdir(), 'oscillo-e2e-'))
const app = await electron.launch({ executablePath: localRequire('electron'), args: ['.', '--no-sandbox', `--user-data-dir=${profile}`], env: { ...process.env, HOME: profile } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2000)
const shot = (n) => win.screenshot({ path: `${process.argv[2] ?? '.'}/${n}.png` })

// Files API
const r = await win.evaluate(async () => {
  const f = window.oscillo.files
  const p = await f.write('~/Oscillo/Logs/x.csv', 'a,b\n1,2\n')
  const back = await f.read(p)
  const png = await f.capture()
  const ver = await f.version()
  return { p, back, png: png.length, ver }
})
console.log('files', JSON.stringify(r))

// Calibration on the Demo Device: step 0 and 1 pass (wavegen 1 loops into C1), step 2 fails (C2 sees W2).
const cal = await win.evaluate(async () => {
  const c = window.oscillo.calibration
  const out = []
  await c.begin()
  for (const i of [0, 1, 2]) {
    try {
      out.push(['ok', i, await c.step(i, 4)])
    } catch (e) {
      out.push(['err', i, e.message])
    }
  }
  return out
})
console.log('calibration', JSON.stringify(cal))

// Device options on Demo: unsupported is reported
const opt = await win.evaluate(async () => {
  try {
    return await window.oscillo.hw.options({ onClose: 1, keepUsb: true, usbLimit: 0.5, led: 50, audio: false, sysFreq: 100e6, clockMode: 0, refFreq: 10e6, digitalVolts: 3.3, threshold: 1.5, driveMa: 8, slew: 2, pull: 'None', triggers: [0, 4] })
  } catch (e) {
    return e.message
  }
})
console.log('options', JSON.stringify(opt))

// Pages render without errors
for (const page of ['export', 'calibration', 'device-options', 'settings', 'device', 'welcome', 'dmm', 'impedance', 'scope', 'logic', 'spectrum', 'network', 'logger']) {
  await win.evaluate((p) => {
    const raw = JSON.parse(localStorage.getItem('oscillo'))
    raw.state.page = p
    localStorage.setItem('oscillo', JSON.stringify(raw))
  }, page)
  await win.reload()
  await win.waitForTimeout(1200)
  await shot(page)
}
// Export page: latest scope capture is published
await win.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('oscillo'))
  raw.state.page = 'scope'
  localStorage.setItem('oscillo', JSON.stringify(raw))
})
await win.reload()
await win.waitForTimeout(1500)
await win.getByRole('button', { name: 'Export and Logging' }).first().click().catch(() => {})
await win.waitForTimeout(500)
await shot('export-live')
console.log('errors', errors)
await app.close()
