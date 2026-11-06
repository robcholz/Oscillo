// MCP server state, shared by the MCP Server page, the top-bar MCP button and the status bar.
// The server runs in the main process (src/main/mcp.ts); settings persist here and are sent to it,
// and its approval requests, audit rows and connected clients come back.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuditRow, ClientId, McpRequest, McpSettings, McpStatus, Perm, Result } from '../../../shared/mcp'
import { useStore } from '../store'

export type { AuditRow, ClientId, Perm, Result }
export const CLIENTS: { id: ClientId; name: string; via: string }[] = [
  { id: 'desktop', name: 'Claude Desktop', via: 'stdio' },
  { id: 'code', name: 'Claude Code', via: 'HTTP 127.0.0.1' },
  { id: 'codex', name: 'Codex', via: 'stdio' },
  { id: 'chatgpt', name: 'ChatGPT', via: 'HTTPS tunnel' }
]

export const TOOL_GROUPS: { g: string; tools: string; kind: 'Read' | 'Output' }[] = [
  { g: 'device', tools: 'list, info, system_monitor', kind: 'Read' },
  { g: 'scope', tools: 'capture, measure, get_waveform', kind: 'Read' },
  { g: 'wavegen', tools: 'run, stop', kind: 'Output' },
  { g: 'supplies', tools: 'set, enable, read', kind: 'Output' },
  { g: 'static_io', tools: 'read, write', kind: 'Output' },
  { g: 'logic', tools: 'capture, decode', kind: 'Read' },
  { g: 'patterns', tools: 'run, stop', kind: 'Output' },
  { g: 'protocol', tools: 'uart_send, i2c_transfer, spi_transfer, can_send', kind: 'Output' },
  { g: 'spectrum', tools: 'measure', kind: 'Read' },
  { g: 'network', tools: 'sweep', kind: 'Output' },
  { g: 'impedance', tools: 'measure', kind: 'Output' },
  { g: 'workspace', tools: 'state', kind: 'Read' },
  { g: 'screenshot', tools: 'capture the window', kind: 'Read' },
  { g: 'script', tools: 'run TypeScript', kind: 'Output' }
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
  clients: { desktop: true, code: true, codex: true, chatgpt: true } as Record<ClientId, boolean>,
  perms: { desktop: 'Outputs with Approval', code: 'Read Only', codex: 'Read Only', chatgpt: 'Read Only' } as Record<ClientId, Perm>
}
type Settings = typeof SETTINGS

interface McpState extends Settings {
  /** Requests waiting for approval, oldest first. */
  requests: McpRequest[]
  allowSession: boolean
  rows: AuditRow[]
  status: McpStatus | null
  set: (p: Partial<McpState>) => void
  resolve: (ok: boolean) => void
  disconnect: (c: ClientId) => void
}

const toast = (t: string, detail?: string): void => useStore.getState().toast(t, detail ? { detail } : undefined)
const api = typeof window !== 'undefined' ? (window.oscillo?.mcp ?? null) : null

export const useMcp = create<McpState>()(
  persist(
    (set, get) => ({
      ...SETTINGS,
      requests: [],
      allowSession: false,
      rows: [],
      status: null,
      set: (p) => set(p),
      resolve: (ok) => {
        const s = get()
        const cur = s.requests[0]
        if (!cur) return
        void api?.resolve(cur.id, ok, s.allowSession)
        set({ requests: s.requests.slice(1), allowSession: false })
        toast(ok ? `Approved ${cur.tool}` : `Denied ${cur.tool}`, ok && s.allowSession ? `Allowed for the rest of ${cur.client}'s session.` : undefined)
      },
      disconnect: (c) => {
        set({ clients: { ...get().clients, [c]: false } })
        void api?.disconnect(c)
      }
    }),
    {
      name: 'oscillo.mcp',
      version: 2,
      // Before the server was real, a client could be left "disconnected" for the demo.
      migrate: (old) => ({ ...(old as object), clients: SETTINGS.clients }) as McpState,
      partialize: ({ requests: _a, allowSession: _b, rows: _c, status: _d, set: _e, resolve: _f, disconnect: _g, ...rest }) => rest
    }
  )
)

const settingsOf = (s: McpState): McpSettings => ({ on: s.on, port: s.port, token: s.token, perm: s.perm, maxV: s.maxV, maxI: s.maxI, maxAmp: s.maxAmp, maxRate: s.maxRate, maxSamples: s.maxSamples, large: s.large, mirror: s.mirror, tools: s.tools, clients: s.clients, perms: s.perms })

// Keep the server's settings current, and collect what it reports.
if (api) {
  let last = ''
  let lastError: string | null = null
  const sync = (): void => {
    const st = settingsOf(useMcp.getState())
    const key = JSON.stringify(st)
    if (key === last) return
    last = key
    void api.settings(st).then((status) => useMcp.setState({ status }))
  }
  useMcp.subscribe(sync)
  setTimeout(sync, 0)
  api.onEvent((e) => {
    if (e.type === 'status') {
      useMcp.setState({ status: e.status })
      if (e.status.error && e.status.error !== lastError) toast('MCP server could not start', e.status.error)
      lastError = e.status.error
    } else if (e.type === 'request') useMcp.setState((s) => ({ requests: [...s.requests, e.request] }))
    else if (e.type === 'cancel') useMcp.setState((s) => ({ requests: s.requests.filter((r) => r.id !== e.id) }))
    else if (e.type === 'audit')
      useMcp.setState((s) => {
        const i = s.rows.findIndex((r) => r.id === e.row.id)
        return { rows: i >= 0 ? s.rows.map((r, k) => (k === i ? e.row : r)) : [e.row, ...s.rows].slice(0, 1000) }
      })
  })
}

/** What the top bar and status bar show. */
export function useMcpSummary(): { on: boolean; pending: number; clients: number } {
  const on = useMcp((s) => s.on)
  const pending = useMcp((s) => (s.on ? s.requests.length : 0))
  const clients = useMcp((s) => (s.on ? new Set((s.status?.sessions ?? []).filter((x) => Date.now() - x.last < 10 * 60e3).map((x) => x.client)).size : 0))
  return { on, pending, clients }
}
