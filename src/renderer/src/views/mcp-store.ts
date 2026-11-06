// MCP server state, shared by the MCP Server page, the top-bar MCP button and the status bar.
// Settings persist; the pending request and audit rows are the session's.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useStore } from '../store'

export type Perm = 'Read Only' | 'Outputs with Approval' | 'Full Control'
export type ClientId = 'desktop' | 'code' | 'codex' | 'chatgpt'
export const CLIENTS: { id: ClientId; name: string; via: string }[] = [
  { id: 'desktop', name: 'Claude Desktop', via: 'stdio' },
  { id: 'code', name: 'Claude Code', via: 'HTTP 127.0.0.1' },
  { id: 'codex', name: 'Codex', via: 'stdio' },
  { id: 'chatgpt', name: 'ChatGPT', via: 'HTTPS tunnel' }
]

export const TOOL_GROUPS: { g: string; tools: string; kind: 'Read' | 'Output' }[] = [
  { g: 'device', tools: 'list, connect, info, system_monitor', kind: 'Read' },
  { g: 'scope', tools: 'configure, capture, get_waveform, measure', kind: 'Read' },
  { g: 'wavegen', tools: 'configure, run, stop', kind: 'Output' },
  { g: 'supplies', tools: 'set, enable, read', kind: 'Output' },
  { g: 'static_io', tools: 'read, write', kind: 'Output' },
  { g: 'logic', tools: 'configure, capture, decode', kind: 'Read' },
  { g: 'patterns', tools: 'configure, run, stop', kind: 'Output' },
  { g: 'protocol', tools: 'uart, i2c, spi, can', kind: 'Output' },
  { g: 'spectrum', tools: 'run, traces, measure', kind: 'Read' },
  { g: 'network', tools: 'sweep, bode', kind: 'Output' },
  { g: 'impedance', tools: 'measure, sweep', kind: 'Output' },
  { g: 'workspace', tools: 'load, save, state', kind: 'Read' },
  { g: 'screenshot', tools: 'capture instrument view', kind: 'Read' },
  { g: 'script', tools: 'run TypeScript', kind: 'Output' }
]

export const REQUESTS = [
  { c: 'Claude Desktop', tool: 'supplies.set', text: 'Claude Desktop wants to set the positive supply to 3.3 V and turn it on. This is within your 5 V limit.', data: { tool: 'supplies.set', rail: 'positive', voltage: 3.3, enable: true } },
  { c: 'Claude Desktop', tool: 'wavegen.run', text: 'Claude Desktop wants to start Wavegen 1 with a 1 kHz, 2 V sine. This is within your 2.5 V amplitude limit.', data: { tool: 'wavegen.run', channel: 1, type: 'Sine', frequency: 1000, amplitude: 2 } },
  { c: 'Claude Desktop', tool: 'static_io.write', text: 'Claude Desktop wants to drive DIO 0 to 3 high as outputs.', data: { tool: 'static_io.write', mask: '0x0F', value: '0x0F' } }
]

export type Result = 'Pending' | 'Allowed' | 'Denied' | 'Error'
export interface AuditRow {
  t: string
  c: string
  tool: string
  r: Result
}

const ROWS: AuditRow[] = [
  { t: '12:06:14', c: 'Claude Desktop', tool: 'supplies.set', r: 'Pending' },
  { t: '12:06:02', c: 'ChatGPT', tool: 'spectrum.get_peaks', r: 'Allowed' },
  { t: '12:05:58', c: 'Codex', tool: 'script.read', r: 'Allowed' },
  { t: '12:05:52', c: 'Claude Desktop', tool: 'scope.capture', r: 'Allowed' },
  { t: '12:05:50', c: 'Claude Desktop', tool: 'scope.configure', r: 'Allowed' },
  { t: '12:05:41', c: 'Claude Desktop', tool: 'device.info', r: 'Allowed' },
  { t: '12:04:47', c: 'ChatGPT', tool: 'supplies.set', r: 'Denied' },
  { t: '12:04:30', c: 'Codex', tool: 'device.info', r: 'Allowed' },
  { t: '12:04:03', c: 'Claude Code', tool: 'wavegen.run', r: 'Denied' },
  { t: '12:03:55', c: 'Claude Code', tool: 'scope.get_waveform', r: 'Error' },
  { t: '11:58:41', c: 'ChatGPT', tool: 'workspace.state', r: 'Allowed' },
  { t: '11:58:20', c: 'Claude Desktop', tool: 'device.list', r: 'Allowed' },
  { t: '11:58:02', c: 'Claude Code', tool: 'workspace.state', r: 'Allowed' },
  { t: '11:57:44', c: 'Claude Code', tool: 'supplies.set', r: 'Denied' }
]

const SETTINGS = {
  on: true,
  transport: 'stdio' as 'stdio' | 'HTTP',
  port: 8765,
  token: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''),
  perm: 'Outputs with Approval' as Perm,
  maxV: 5,
  maxI: 0.5,
  maxAmp: 2.5,
  maxRate: 10e6,
  maxSamples: 2048,
  large: 'Summary + Resource URI',
  mirror: true,
  override: true,
  tools: Object.fromEntries(TOOL_GROUPS.map((t) => [t.g, t.g !== 'script'])) as Record<string, boolean>,
  clients: { desktop: true, code: false, codex: true, chatgpt: true } as Record<ClientId, boolean>,
  perms: { desktop: 'Outputs with Approval', code: 'Read Only', codex: 'Read Only', chatgpt: 'Read Only' } as Record<ClientId, Perm>
}
type Settings = typeof SETTINGS

interface McpState extends Settings {
  /** Index into REQUESTS of the request waiting for approval, or -1. */
  req: number
  allowSession: boolean
  allowed: Record<string, boolean>
  rows: AuditRow[]
  set: (p: Partial<McpState>) => void
  resolve: (ok: boolean) => void
  simulate: () => void
}

const now = (): string => new Date().toTimeString().slice(0, 8)
const toast = (t: string, detail?: string): void => useStore.getState().toast(t, detail ? { detail } : undefined)

export const useMcp = create<McpState>()(
  persist(
    (set, get) => ({
      ...SETTINGS,
      req: 0,
      allowSession: false,
      allowed: {},
      rows: ROWS,
      set: (p) => set(p),
      resolve: (ok) => {
        const s = get()
        const cur = REQUESTS[s.req]
        if (!cur) return
        const row: AuditRow = { t: now(), c: cur.c, tool: cur.tool, r: ok ? 'Allowed' : 'Denied' }
        const i = s.rows.findIndex((r) => r.r === 'Pending')
        const rows = i >= 0 ? s.rows.map((r, k) => (k === i ? row : r)) : [row, ...s.rows]
        set({ rows, req: -1, allowed: ok && s.allowSession ? { ...s.allowed, [cur.tool]: true } : s.allowed, allowSession: false })
        toast(ok ? `Approved ${cur.tool}` : `Denied ${cur.tool}`, ok && s.allowSession ? 'Allowed for the rest of this session.' : undefined)
      },
      simulate: () => {
        const s = get()
        if (!s.on) return set({ on: true })
        const n = (Math.max(0, s.req) + 1) % REQUESTS.length
        const r = REQUESTS[n]
        if (s.allowed[r.tool] || s.perm === 'Full Control') {
          set({ rows: [{ t: now(), c: r.c, tool: r.tool, r: 'Allowed' }, ...s.rows], req: -1 })
          return toast(`${r.tool} ran without approval`, s.perm === 'Full Control' ? 'Default permission is Full Control.' : 'Allowed for this session.')
        }
        if (s.perm === 'Read Only') {
          set({ rows: [{ t: now(), c: r.c, tool: r.tool, r: 'Denied' }, ...s.rows], req: -1 })
          return toast(`Denied ${r.tool}`, 'Default permission is Read Only.')
        }
        set({ req: n, rows: [{ t: now(), c: r.c, tool: r.tool, r: 'Pending' }, ...s.rows] })
      }
    }),
    {
      name: 'oscillo.mcp',
      partialize: ({ req: _a, allowSession: _b, allowed: _c, rows: _d, set: _e, resolve: _f, simulate: _g, ...rest }) => rest
    }
  )
)

/** What the top bar and status bar show. */
export function useMcpSummary(): { on: boolean; pending: number; clients: number } {
  const on = useMcp((s) => s.on)
  const pending = useMcp((s) => (s.on && s.req >= 0 ? 1 : 0))
  const clients = useMcp((s) => (s.on ? Object.values(s.clients).filter(Boolean).length : 0))
  return { on, pending, clients }
}
