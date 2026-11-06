// Runs a script against the Demo Device in the built app and prints the console. Debug aid.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
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
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
const code = process.argv[2]
const out = await win.evaluate(async (code) => {
  const s = window.oscillo.script
  const events = []
  s.onEvent((e) => {
    events.push(e)
    if (e.type === 'paused') setTimeout(() => s.resume(false), 50)
  })
  const files = { 'a.ts': code, 'units.ts': 'export const kHz = 1e3;' }
  const problems = await s.check(files, 'a.ts')
  await s.run(files, 'a.ts', { timeout: 20, breakpoints: { 'a.ts': [4] }, network: false })
  await new Promise((r) => setTimeout(r, 300))
  return { problems, events: events.filter((e) => e.type !== 'apply') }
}, code)
console.log(JSON.stringify(out, null, 1))
if (errors.length) console.log('ERRORS', errors)
await app.close()
