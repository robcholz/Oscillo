// Starts the built app and talks to its MCP server with the official SDK client, over HTTP and
// through the stdio bridge, then checks the bridge's error when the app is closed. Debug aid.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const groot = createRequire(execSync('npm root -g').toString().trim() + '/')
const { _electron: electron } = groot('playwright')
const local = createRequire(import.meta.url)
const { Client } = local('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = local('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { StdioClientTransport } = local('@modelcontextprotocol/sdk/client/stdio.js')
const profile = mkdtempSync(join(tmpdir(), 'oscillo-mcp-'))
const electronBin = local('electron')
const app = await electron.launch({ executablePath: electronBin, args: ['.', '--no-sandbox', `--user-data-dir=${profile}`], env: { ...process.env, HOME: profile } })
const win = await app.firstWindow()
await win.waitForTimeout(3500)
const ud = await app.evaluate(({ app }) => app.getPath('userData'))
const cfg = JSON.parse(readFileSync(join(ud, 'mcp.json'), 'utf8'))
console.log('cfg port', cfg.port, 'token?', !!cfg.token)
// HTTP
const c = new Client({ name: 'claude-code', version: '1.0.0' })
await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${cfg.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } } }))
console.log('server', c.getServerVersion(), 'instructions?', !!c.getInstructions())
const tools = await c.listTools(); console.log('tools', tools.tools.length, tools.tools.slice(0, 3).map((t) => t.name))
const r = await c.callTool({ name: 'device_info', arguments: {} }); console.log('device_info', r.isError ?? false, r.content[0].text.slice(0, 80).replace(/\n/g, ' '))
const cap = await c.callTool({ name: 'scope_capture', arguments: { samples: 1024 } }); console.log('scope_capture', cap.isError ?? false, cap.content[0].text.slice(0, 80).replace(/\n/g, ' '))
const res = await c.listResources(); console.log('resources', res.resources.map((x) => x.uri).join(' '))
const rd = await c.readResource({ uri: 'oscillo://device' }); console.log('read', rd.contents[0].text.slice(0, 60).replace(/\n/g, ' '))
try { await c.readResource({ uri: 'oscillo://nope' }) } catch (e) { console.log('bad resource ->', e.message) }
const sess = await win.evaluate(() => document.body.innerText.includes('Claude Code'))
await c.close()
// bad token
const bad = new Client({ name: 'x', version: '1' })
try { await bad.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${cfg.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer nope' } } })); console.log('bad token connected?!') } catch (e) { console.log('bad token ->', e.message.slice(0, 90)) }
// stdio bridge
const s = new Client({ name: 'codex', version: '1.0.0' })
await s.connect(new StdioClientTransport({ command: electronBin, args: ['.', '--no-sandbox', '--mcp-stdio', `--user-data-dir=${profile}`], cwd: process.cwd(), env: { ...process.env, HOME: profile }, stderr: 'ignore' }))
const t2 = await s.listTools(); console.log('stdio tools', t2.tools.length)
const r2 = await s.callTool({ name: 'device_list', arguments: {} }); console.log('stdio device_list', r2.content[0].text.slice(0, 60).replace(/\n/g, ' '))
await s.close()
await app.close()
// stdio with app closed
const s3 = new Client({ name: 'codex', version: '1.0.0' })
try { await s3.connect(new StdioClientTransport({ command: electronBin, args: ['.', '--no-sandbox', '--mcp-stdio', `--user-data-dir=${profile}`], cwd: process.cwd(), env: { ...process.env, HOME: profile }, stderr: 'ignore' })); console.log('connected without app?!') } catch (e) { console.log('app closed ->', e.message.slice(0, 120)) }
await s3.close().catch(() => {})
process.exit(0)
