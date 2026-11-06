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
// FPGA Utility: scan and program the Demo Device's simulated XC7A35T with a full-size bitstream.
{
  const { writeFileSync } = await import('node:fs')
  const data = [...new Array(16).fill(0xff), 0, 0, 0, 0xbb, 0x11, 0x22, 0, 0x44, 0xff, 0xff, 0xff, 0xff, 0xaa, 0x99, 0x55, 0x66]
  const body = new Uint8Array(2192012)
  body.set(data)
  for (let i = data.length; i < body.length; i++) body[i] = (i * 37) & 0xff
  const out = [0x00, 0x09, 0x0f, 0xf0, 0x0f, 0xf0, 0x0f, 0xf0, 0x0f, 0xf0, 0x00, 0x00, 0x01]
  for (const [k, v] of [['a', 'blinky;UserID=0XFFFFFFFF'], ['b', '7a35tcpg236'], ['c', '2026/11/06'], ['d', '12:00:00']]) {
    const b = [...Buffer.from(v), 0]
    out.push(k.charCodeAt(0), b.length >> 8, b.length & 0xff, ...b)
  }
  const n = body.length
  out.push(0x65, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
  const file = join(profile, 'blinky.bit')
  writeFileSync(file, Buffer.concat([Buffer.from(out), Buffer.from(body)]))
  await win.evaluate((f) => {
    const raw = JSON.parse(localStorage.getItem('oscillo'))
    raw.state.page = 'fpga'
    localStorage.setItem('oscillo', JSON.stringify(raw))
    localStorage.setItem('oscillo.fpga', JSON.stringify({ state: { path: f }, version: 1 }))
  }, file)
  await win.reload()
  await win.waitForTimeout(1500)
  await win.getByRole('button', { name: 'Scan Chain' }).click()
  await win.waitForTimeout(1500)
  const chain = await win.locator('table').first().innerText()
  const t0 = Date.now()
  await win.getByRole('button', { name: 'Program FPGA' }).click()
  await win.waitForTimeout(400)
  await shot('fpga-busy')
  await win.getByText('Programmed blinky.bit').first().waitFor({ timeout: 60000 })
  console.log('fpga', JSON.stringify({ chain, seconds: (Date.now() - t0) / 1000 }))
  await shot('fpga')
}
console.log('errors', errors)
await app.close()
