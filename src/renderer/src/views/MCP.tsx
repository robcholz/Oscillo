// MCP Server (board: MCP). The approval card for agent output requests, connected clients and the
// audit log, tool groups and resources; transport, permissions and limits on the right.
import {
  Badge, Button, Checkbox, ChoiceboxGroup, DotsMenu, Entity, Fieldset, FormModal, Input, Material, MenuItem, MenuSeparator, Modal, Note,
  RadioGroup, Select, Snippet, StatusDot, Switch, Table, Tabs, Toggle, type BadgeVariant
} from '@robcholz/geist'
import { Check, Copy, Download, FileText, History, Plug, Power, ShieldCheck } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { ChatGPTIcon, ClaudeCodeIcon, ClaudeIcon, CodexIcon } from '../components/icons'
import { Grid2, PageBar, PanelSection, SplitPage } from '../components/Page'
import { UnitInput } from '../components/UnitInput'
import { useInterval } from '../components/useInterval'
import { saveText } from '../files'
import { useStore } from '../store'
import { CLIENTS, TOOL_GROUPS, useMcp, type AuditRow, type ClientId, type Perm, type Result } from './mcp-store'

const ICONS: Record<ClientId, ComponentType<{ size?: number }>> = { desktop: ClaudeIcon, code: ClaudeCodeIcon, codex: CodexIcon, chatgpt: ChatGPTIcon }
const RESULT: Record<Result, BadgeVariant> = { Pending: 'amber-subtle', Allowed: 'green-subtle', Denied: 'red-subtle', Error: 'red-subtle' }
const PERMS: Perm[] = ['Read Only', 'Outputs with Approval', 'Full Control']
const RESOURCES = [
  { uri: 'oscillo://device', desc: 'Connected device, configuration and serial number.', type: 'JSON' },
  { uri: 'oscillo://instruments/state', desc: 'Settings and run state of every open instrument.', type: 'JSON' },
  { uri: 'oscillo://scope/last-capture', desc: 'Most recent oscilloscope capture, summarized above 2,048 samples.', type: 'CSV' },
  { uri: 'oscillo://logic/last-capture', desc: 'Most recent logic capture with decoded frames.', type: 'JSON' }
]
const SHOWN = 10

const ago = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60e3)
  return m < 1 ? 'Just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

function Json({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  return (
    <pre className="m-0 overflow-x-auto rounded-small bg-background-200 p-3 font-mono text-[13px] leading-5 shadow-[0_0_0_1px_var(--gray-alpha-400)]">
      {'{\n'}
      {entries.map(([k, v], i) => (
        <span key={k}>
          {'  '}
          <span className="text-blue-900">"{k}"</span>: <span className={typeof v === 'string' ? 'text-green-900' : 'text-amber-900'}>{JSON.stringify(v)}</span>
          {i < entries.length - 1 ? ',\n' : '\n'}
        </span>
      ))}
      {'}'}
    </pre>
  )
}


export function MCP() {
  const m = useMcp()
  const toast = useStore((s) => s.toast)
  const [tab, setTab] = useState('Activity')
  const [more, setMore] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [permFor, setPermFor] = useState<ClientId | null>(null)
  const [permDraft, setPermDraft] = useState<Perm>('Read Only')
  const [, tick] = useState(0)
  useInterval(() => tick((x) => x + 1), 30e3, true)

  const cur = m.on ? (m.requests[0] ?? null) : null
  const st = m.status
  const httpSetup = `claude mcp add --transport http oscillo ${st?.url ?? `http://127.0.0.1:${m.port}/mcp`} --header "Authorization: Bearer ${m.token}"`
  const stdioSetup = st?.stdio ?? 'Oscillo --mcp-stdio'
  // Connected: a session that made a request in the last 10 minutes.
  const sessionOf = (id: ClientId) => (st?.sessions ?? []).filter((x) => x.id === id && Date.now() - x.last < 10 * 60e3).sort((a, b) => a.since - b.since)[0]
  const others = (st?.sessions ?? []).filter((x) => !x.id && Date.now() - x.last < 10 * 60e3)
  const rows = more ? m.rows : m.rows.slice(0, SHOWN)
  const copy = (text: string, what: string): void => {
    void navigator.clipboard?.writeText(text)
    toast(`Copied ${what}`)
  }

  const bar = (
    <PageBar title="MCP Server" status={<StatusDot state={m.on ? 'READY' : 'QUEUED'} label={m.on ? 'Running' : 'Stopped'} />}>
      <Toggle
        checked={m.on}
        onChange={(on) => {
          m.set({ on })
          toast(on ? 'MCP server started' : 'MCP server stopped', on ? undefined : { detail: 'Clients were disconnected.' })
        }}
      >
        Server Enabled
      </Toggle>
    </PageBar>
  )

  const panel = (
    <>
      <PanelSection title="Transport" actions={<Switch aria-label="Transport" value={m.transport} options={['stdio', 'HTTP']} onChange={(transport) => m.set({ transport })} />}>
        <Snippet className="[&_code]:whitespace-pre-wrap [&_code]:[overflow-wrap:anywhere]" text={m.transport === 'HTTP' ? httpSetup : stdioSetup} onCopy={() => toast('Copied to clipboard')} />
        <Note type="secondary" size="small">
          {m.transport === 'HTTP' ? 'Run this to add Oscillo to Claude Code. Other HTTP clients use the same URL and token.' : 'Add this command as a stdio server in Claude Desktop or Codex. It connects to Oscillo while it is open.'}
        </Note>
        {m.transport === 'HTTP' && (
          <>
            <Grid2>
              <UnitInput label="HTTP Port" value={m.port} integer min={1024} max={65535} onCommit={(port) => m.set({ port })} />
              <div className="flex min-w-0 flex-col gap-2">
                <label htmlFor="mcp-token" className="text-[13px] leading-4 text-gray-900">
                  Token
                </label>
                <Input
                  id="mcp-token"
                  size="small"
                  type="password"
                  readOnly
                  value={m.token}
                  suffix={
                    <Button type="tertiary" size="small" svgOnly aria-label="Copy Token" tooltip className="-mr-1.5 h-6 w-6" onClick={() => copy(m.token, 'token')}>
                      <Copy size={14} />
                    </Button>
                  }
                />
              </div>
            </Grid2>
            <Note type="secondary" size="small">
              HTTP listens on 127.0.0.1 only.
            </Note>
          </>
        )}
      </PanelSection>
      <PanelSection title="Permissions">
        <ChoiceboxGroup
          aria-label="Default Permission"
          columns={1}
          value={m.perm}
          onChange={(perm) => {
            m.set({ perm })
            toast(`Default permission: ${perm}`)
          }}
          options={[
            { value: 'Read Only', label: 'Read Only', description: 'Capture and measure. No outputs.' },
            { value: 'Outputs with Approval', label: 'Outputs with Approval', description: 'You approve each supply, wavegen, pattern or DIO change.' },
            { value: 'Full Control', label: 'Full Control', description: 'Within the output limits below.' }
          ]}
        />
      </PanelSection>
      <PanelSection title="Output Limits">
        <Grid2>
          <UnitInput label="Max Voltage" value={m.maxV} suffix="V" min={0} max={5} onCommit={(maxV) => m.set({ maxV })} />
          <UnitInput label="Max Current" value={m.maxI} scale={1e-3} suffix="mA" min={0} max={700} onCommit={(maxI) => m.set({ maxI })} />
          <UnitInput label="Max Amplitude" value={m.maxAmp} suffix="V" min={0} max={5} onCommit={(maxAmp) => m.set({ maxAmp })} />
          <UnitInput label="Max DIO Rate" value={m.maxRate} scale={1e6} suffix="MHz" min={0} max={100} onCommit={(maxRate) => m.set({ maxRate })} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Data" className="shadow-none">
        <UnitInput label="Max Samples Returned" value={m.maxSamples} integer min={16} max={1_000_000} onCommit={(maxSamples) => m.set({ maxSamples })} />
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[13px] leading-4 text-gray-900">Large Captures</span>
            <Select size="small" aria-label="Large Captures" value={m.large} options={['Summary + Resource URI', 'File Path']} onValueChange={(large) => m.set({ large })} />
          </div>
        <Toggle layout="row" checked={m.mirror} onChange={(mirror) => m.set({ mirror })}>
          Mirror Agent Changes in UI
        </Toggle>
        <Toggle layout="row" checked={m.override} onChange={(override) => m.set({ override })}>
          Your Input Overrides Agent
        </Toggle>
      </PanelSection>
    </>
  )

  return (
    <SplitPage bar={bar} panelId="mcp" panel={panel}>
      {cur ? (
        <Fieldset
          type="warning"
          titleSize={16}
          title="Approval Needed"
          subtitle={cur.text}
          footer={`Requested by ${cur.client}${m.requests.length > 1 ? ` · ${m.requests.length - 1} more waiting` : ''}`}
          actions={
            <>
              <Button type="secondary" size="small" onClick={() => m.resolve(false)}>
                Deny Request
              </Button>
              <Button size="small" prefix={<Check size={16} />} onClick={() => m.resolve(true)}>
                Approve Output
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Json data={cur.data} />
            <Checkbox checked={m.allowSession} onChange={(allowSession) => m.set({ allowSession })}>
              Allow <code className="font-mono text-[13px]">{cur.tool}</code> for This Session
            </Checkbox>
          </div>
        </Fieldset>
      ) : (
        <Note
          type="secondary"
          size="small"
          action={
            m.on ? (
              <Button type="secondary" size="small" prefix={<Copy size={16} />} onClick={() => copy(m.transport === 'HTTP' ? httpSetup : stdioSetup, 'setup command')}>
                Copy Setup
              </Button>
            ) : (
              <Button type="secondary" size="small" onClick={() => m.set({ on: true })}>
                Start Server
              </Button>
            )
          }
        >
          {m.on ? (st?.listening ? `No requests are waiting for approval. Listening on ${st.url}.` : (st?.error ?? 'Starting the server…')) : 'The server is stopped. Turn it on to accept client requests.'}
        </Note>
      )}

      <Tabs tabs={['Activity', 'Tools', 'Resources'].map((t) => ({ title: t, value: t }))} selected={tab} setSelected={setTab} />

      {tab === 'Activity' && (
        <>
          <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">Connected Clients</h2>
          <Material className="overflow-hidden [&>*:last-child]:shadow-none">
            {CLIENTS.map((c) => {
              const Icon = ICONS[c.id]
              const sess = m.on && m.clients[c.id] ? sessionOf(c.id) : undefined
              return (
                <Entity key={c.id} icon={<Icon size={16} />} title={c.name} description={`${c.via} · ${m.perms[c.id]}`}>
                  {sess ? (
                    <span className="text-[13px] tabular-nums text-gray-900" title={new Date(sess.since).toLocaleString()}>
                      Connected {ago(sess.since)}
                    </span>
                  ) : (
                    <Badge variant="gray-subtle" size="sm">
                      {m.clients[c.id] ? 'Not Connected' : 'Blocked'}
                    </Badge>
                  )}
                  <DotsMenu
                    aria-label={`${c.name} Actions`}
                    menu={
                      <>
                        <MenuItem
                          prefix={<ShieldCheck size={16} />}
                          onSelect={() => {
                            setPermDraft(m.perms[c.id])
                            setPermFor(c.id)
                          }}
                        >
                          Change Permissions
                        </MenuItem>
                        <MenuItem prefix={<History size={16} />} onSelect={() => setMore(true)}>
                          View Activity
                        </MenuItem>
                        <MenuSeparator />
                        {m.clients[c.id] ? (
                          <MenuItem
                            danger
                            prefix={<Power size={16} />}
                            onSelect={() => {
                              m.disconnect(c.id)
                              toast(`${c.name} disconnected`, { detail: 'It cannot reconnect until you allow it.' })
                            }}
                          >
                            Disconnect Client
                          </MenuItem>
                        ) : (
                          <MenuItem
                            prefix={<Plug size={16} />}
                            onSelect={() => {
                              m.set({ clients: { ...m.clients, [c.id]: true } })
                              toast(`${c.name} can reconnect`)
                            }}
                          >
                            Allow Reconnect
                          </MenuItem>
                        )}
                      </>
                    }
                  />
                </Entity>
              )
            })}
            {others.map((o) => (
              <Entity key={o.client + o.since} icon={<Plug size={16} />} title={o.client} description={`HTTP · ${m.perm}`}>
                <span className="text-[13px] tabular-nums text-gray-900" title={new Date(o.since).toLocaleString()}>
                  Connected {ago(o.since)}
                </span>
              </Entity>
            ))}
          </Material>

          <div className="flex items-center justify-between">
            <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">Audit Log</h2>
            <Button type="secondary" size="small" prefix={<Download size={16} />} onClick={() => setExportOpen(true)}>
              Export Log
            </Button>
          </div>
          <Table<AuditRow>
            caption="MCP audit log"
            compact
            columns={[
              { key: 't', title: 'Time', mono: true, width: 96 },
              { key: 'c', title: 'Client' },
              { key: 'tool', title: 'Tool', mono: true },
              {
                key: 'r',
                title: 'Result',
                render: (r) => (
                  <Badge variant={RESULT[r.r]} size="sm">
                    {r.r}
                  </Badge>
                )
              }
            ]}
            rows={rows}
            rowKey={(r) => r.id}
          />
          {m.rows.length > SHOWN && (
            <div className="flex justify-center">
              <Button type="tertiary" size="small" onClick={() => setMore(!more)}>
                {more ? 'Show Fewer' : `Show ${m.rows.length - SHOWN} More`}
              </Button>
            </div>
          )}
        </>
      )}

      {tab === 'Tools' && (
        <>
          <h2 className="m-0 text-sm font-semibold leading-5 tracking-[-0.28px]">Tools</h2>
          <Material className="overflow-hidden">
            <div className="grid grid-cols-[140px_minmax(0,1fr)_96px_48px] items-center gap-4 bg-background-200 px-4 py-2 text-xs font-medium text-gray-900 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]">
              <span>Tool Group</span>
              <span>Tools</span>
              <span>Kind</span>
              <span className="sr-only">Enabled</span>
            </div>
            {TOOL_GROUPS.map((t) => (
              <div key={t.g} className="grid grid-cols-[140px_minmax(0,1fr)_96px_48px] items-center gap-4 px-4 py-2.5 [&+&]:shadow-[inset_0_1px_0_var(--gray-alpha-200)]">
                <span className="font-mono text-[13px] leading-5">{t.g}</span>
                <span className="text-[13px] leading-4 text-gray-900">{t.tools}</span>
                <span className="flex">
                  <Badge variant={t.kind === 'Output' ? 'amber-subtle' : 'gray-subtle'} size="sm">
                    {t.kind}
                  </Badge>
                </span>
                <Toggle
                  aria-label={`Enable ${t.g} tools`}
                  checked={m.tools[t.g]}
                  onChange={(on) => {
                    m.set({ tools: { ...m.tools, [t.g]: on } })
                    toast(`${on ? 'Enabled' : 'Disabled'} ${t.g} tools for all clients`)
                  }}
                />
              </div>
            ))}
          </Material>
        </>
      )}

      {tab === 'Resources' && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="m-0 text-sm font-semibold leading-5 tracking-[-0.28px]">Resources</h2>
            <p className="m-0 mt-0.5 text-[13px] leading-[18px] text-gray-900">Read-only data agents can fetch. Paste a URI into a client to attach it.</p>
          </div>
          <Material className="overflow-hidden [&>*:last-child]:shadow-none">
            {RESOURCES.map((r) => (
              <Entity key={r.uri} icon={<FileText size={16} />} title={<span className="font-mono text-[13px]">{r.uri}</span>} description={r.desc}>
                <Badge variant="gray-subtle" size="sm">
                  {r.type}
                </Badge>
                <Button type="tertiary" size="small" svgOnly aria-label={`Copy ${r.uri}`} tooltip="Copy URI" onClick={() => copy(r.uri, r.uri)}>
                  <Copy size={16} />
                </Button>
              </Entity>
            ))}
          </Material>
        </div>
      )}

      <FormModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export Audit Log"
        submitLabel="Export"
        fields={[
          { key: 'f', label: 'Format', type: 'select', options: ['CSV', 'JSON Lines'] },
          { key: 'n', label: 'File Name', value: 'mcp-audit.csv', mono: true, required: true }
        ]}
        onSubmit={(v) => {
          const text = v.f === 'CSV' ? ['time,client,tool,result', ...m.rows.map((r) => [r.t, r.c, r.tool, r.r].join(','))].join('\n') : m.rows.map((r) => JSON.stringify(r)).join('\n')
          setExportOpen(false)
          void saveText(v.n, text, [{ name: v.f, extensions: [v.f === 'CSV' ? 'csv' : 'jsonl'] }])
        }}
      />

      <Modal
        open={permFor !== null}
        onClose={() => setPermFor(null)}
        title={`Permissions · ${CLIENTS.find((c) => c.id === permFor)?.name ?? ''}`}
        description="Overrides the default permission for this client."
        actions={
          <>
            <Button type="secondary" size="small" onClick={() => setPermFor(null)}>
              Cancel
            </Button>
            <Button
              size="small"
              onClick={() => {
                if (!permFor) return
                m.set({ perms: { ...m.perms, [permFor]: permDraft } })
                toast(`${CLIENTS.find((c) => c.id === permFor)?.name}: ${permDraft}`)
                setPermFor(null)
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <RadioGroup aria-label="Permission" value={permDraft} onChange={setPermDraft} options={PERMS.map((p) => ({ value: p, label: p }))} />
      </Modal>
    </SplitPage>
  )
}
