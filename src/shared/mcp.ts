// The MCP server runs in the main process (src/main/mcp.ts). The renderer owns its settings, shows
// approval requests and the audit log.

export type Perm = 'Read Only' | 'Outputs with Approval' | 'Full Control'
export type ClientId = 'desktop' | 'code' | 'codex' | 'chatgpt'
export type Result = 'Pending' | 'Allowed' | 'Denied' | 'Error'

export interface McpSettings {
  on: boolean
  port: number
  token: string
  perm: Perm
  maxV: number
  maxI: number
  maxAmp: number
  maxRate: number
  maxSamples: number
  large: string
  mirror: boolean
  tools: Record<string, boolean>
  clients: Record<ClientId, boolean>
  perms: Record<ClientId, Perm>
}

export interface McpRequest {
  id: string
  client: string
  tool: string
  text: string
  data: Record<string, unknown>
}

export interface AuditRow {
  id: string
  t: string
  c: string
  tool: string
  r: Result
  detail?: string
}

export interface McpStatus {
  listening: boolean
  url: string
  /** Command a stdio client runs. */
  stdio: string
  error: string | null
  /** Connected clients: id (or name for others) → connected since (ms). */
  sessions: { client: string; id: ClientId | null; since: number; last: number }[]
}

export type McpEvent = { type: 'status'; status: McpStatus } | { type: 'request'; request: McpRequest } | { type: 'cancel'; id: string } | { type: 'audit'; row: AuditRow }

export const MCP = {
  settings: 'mcp:settings',
  resolve: 'mcp:resolve',
  disconnect: 'mcp:disconnect',
  event: 'mcp:event'
} as const

export interface McpApi {
  settings(s: McpSettings): Promise<McpStatus>
  resolve(id: string, ok: boolean, session: boolean): Promise<void>
  disconnect(client: ClientId): Promise<void>
  onEvent(fn: (e: McpEvent) => void): () => void
}
