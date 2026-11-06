// Launches the built app and screenshots pages. Usage: node scripts/screenshot.mjs [outDir] [page…]
// (Linux CI: wrap in xvfb-run). Pages are ids from src/renderer/src/routes.ts; default is all.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Uses a globally installed Playwright (no browser download needed for Electron).
const require = createRequire(execSync('npm root -g').toString().trim() + '/')
const { _electron: electron } = require('playwright')
const localRequire = createRequire(import.meta.url)

const [out = 'screenshots', ...only] = process.argv.slice(2)
const theme = process.env.THEME ?? 'dark'
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'oscillo-shot-'))
const app = await electron.launch({
  executablePath: localRequire('electron'),
  args: ['.', '--no-sandbox', `--user-data-dir=${profile}`],
  env: { ...process.env, HOME: profile }
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await win.setViewportSize({ width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) })
await win.waitForLoadState('domcontentloaded')
const pages = await win.evaluate(() => JSON.parse(localStorage.getItem('oscillo') ?? '{}'))
void pages
const ids = only.length
  ? only
  : ['welcome', 'device', 'device-options', 'calibration', 'export', 'scope', 'wavegen', 'supplies', 'voltmeter', 'dmm', 'logger', 'logic', 'patterns', 'static-io', 'protocol', 'spectrum', 'network', 'impedance', 'tracer', 'script', 'mcp', 'settings', 'fpga']
for (const id of ids) {
  await win.evaluate(
    ([id, theme]) => {
      const raw = JSON.parse(localStorage.getItem('oscillo') ?? '{"state":{},"version":1}')
      raw.state = { ...raw.state, page: id, theme }
      localStorage.setItem('oscillo', JSON.stringify(raw))
    },
    [id, theme]
  )
  await win.reload()
  await win.waitForTimeout(700)
  // SCROLL=px scrolls each page's scroll area, to check what sits below the fold.
  if (process.env.SCROLL) {
    await win.evaluate((y) => document.querySelectorAll('main .overflow-auto').forEach((e) => (e.scrollTop = y)), Number(process.env.SCROLL))
    await win.waitForTimeout(200)
  }
  await win.screenshot({ path: join(out, `${id}.png`) })
  console.log('saved', id)
}
if (errors.length) console.log('ERRORS\n' + [...new Set(errors)].join('\n'))
await app.close()
