// Starts the built app, talks to its MCP server over HTTP and through the stdio bridge. Debug aid.
import { createRequire } from 'node:module'
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(execSync('npm root -g').toString().trim() + '/')
const { _electron: electron } = require('playwright')
const localRequire = createRequire(import.meta.url)
const profile = mkdtempSync(join(tmpdir(), 'oscillo-mcp-'))
const app = await electron.launch({ executablePath: localRequire('electron'), args: ['.', '--no-sandbox', `--user-data-dir=${profile}`], env: { ...process.env, HOME: profile } })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2500)
const cfg = JSON.parse(readFileSync(join(profile, 'mcp.json'), 'utf8'))
let sid
const rpc = async (method, params = {}, id = Math.random()) => {
  const r = await fetch(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}`, ...(sid ? { 'Mcp-Session-Id': sid } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
  sid = r.headers.get('mcp-session-id') ?? sid
  return r.json()
}
const short = (x) => JSON.stringify(x).slice(0, 400)
console.log('init', short(await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-ai' }, capabilities: {} })))
console.log('tools', (await rpc('tools/list')).result.tools.map((t) => t.name).join(' '))
console.log('capture', short(await rpc('tools/call', { name: 'scope_capture', arguments: {} })))
console.log('measure', short(await rpc('tools/call', { name: 'scope_measure', arguments: { channel: 1, names: ['Frequency', 'PeakToPeak'] } })))
// An output needs approval: approve it on the MCP page.
await win.evaluate(() => { const raw = JSON.parse(localStorage.getItem('oscillo') ?? '{"state":{}}'); raw.state.page = 'mcp'; localStorage.setItem('oscillo', JSON.stringify(raw)) })
await win.reload()
await win.waitForTimeout(1500)
const call = rpc('tools/call', { name: 'supplies_set', arguments: { rail: 'positive', voltage: 3.3, enable: true } })
await win.waitForTimeout(800)
const sub = await win.evaluate(() => document.body.innerText.match(/Claude Desktop wants[^\n]*/)?.[0])
console.log('card:', sub)
await win.getByRole('button', { name: 'Approve Output' }).click()
console.log('supplies', short(await call))
console.log('script', short(await rpc('tools/call', { name: 'script_run', arguments: { code: 'import { supplies } from "oscillo";\nconsole.log(supplies.positive.read().voltage.toFixed(2));' } })))
console.log('audit:', await win.evaluate(() => document.querySelector('[aria-label="MCP audit log"]')?.innerText.slice(0, 300) ?? document.body.innerText.slice(0, 50)))
// stdio bridge
const child = spawn(localRequire('electron'), ['.', '--no-sandbox', `--user-data-dir=${profile}`, '--mcp-stdio'], { env: { ...process.env, HOME: profile } })
let out = ''
child.stdout.on('data', (d) => (out += d))
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'codex' }, capabilities: {} } }) + '\n')
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'device_info', arguments: {} } }) + '\n')
await new Promise((r) => setTimeout(r, 4000))
console.log('stdio:', out.slice(0, 600))
child.kill()
await app.close()
