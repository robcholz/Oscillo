// The 32px status bar: device and link, acquisition, temperature, USB power, buffer; script and MCP status.
import { Tooltip, cn } from '@robcholz/geist'
import { Check, Cpu, PlugZap, Thermometer, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { ModelContextProtocolIcon, TypeScriptIcon } from '../components/icons'
import { CONFIGS, devices } from '../devices'
import type { PageId } from '../routes'
import { useStore } from '../store'
import { useMcpSummary } from '../views/mcp-store'

const item = 'box-border inline-flex h-6 items-center gap-1.5 rounded-kbd px-2 text-gray-900 no-underline'
const link = 'cursor-pointer hover:bg-gray-alpha-200 hover:text-gray-1000 kbd-focus:shadow-focus-ring'
const mono = 'font-mono text-[11px] tabular-nums'

function Sep({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('mx-1 h-4 w-px flex-none bg-gray-alpha-400', className)} />
}

function Item({ tip, keys, to, onClick, label, className, children }: { tip: string; keys?: string[]; to?: PageId; onClick?: () => void; label?: string; className?: string; children: ReactNode }) {
  const go = useStore((s) => s.go)
  const act = onClick ?? (to ? () => go(to) : undefined)
  return (
    <Tooltip text={tip} keys={keys} position="top" delay={200}>
      {act ? (
        <button type="button" aria-label={label} onClick={act} className={cn(item, link, className)}>
          {children}
        </button>
      ) : (
        <span className={cn(item, className)}>{children}</span>
      )}
    </Tooltip>
  )
}

export function StatusBar() {
  const s = useStore()
  const mcp = useMcpSummary()
  const cfg = CONFIGS.find((c) => c.value === s.config) ?? CONFIGS[0]
  const dev = s.device ? devices[s.device] : null
  const running = s.running && !!dev
  return (
    <footer
      role="status"
      aria-label="Status"
      className="flex h-8 flex-none items-center justify-between gap-3 overflow-hidden whitespace-nowrap bg-background-200 px-2 text-xs text-gray-900 shadow-[inset_0_1px_0_var(--gray-alpha-400)]"
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <Item
          to="device"
          tip={!dev ? 'No device. Open Device Manager to connect one.' : dev.link === 'SIM' ? 'Simulated captures. Open Device Manager to connect hardware.' : `Connected over ${dev.link}. Open Device Manager.`}
          label={dev ? `${dev.name}, connected over ${dev.link}` : 'No device connected'}
        >
          <span className={cn('size-2 flex-none rounded-full', !dev ? 'bg-red-800' : dev.link === 'SIM' ? 'bg-amber-700' : 'bg-blue-700')} />
          <b className="font-medium text-gray-1000">{dev ? dev.name : 'No Device'}</b>
          {dev && <span className="h-4 rounded-kbd bg-gray-alpha-200 px-[5px] font-mono text-[10px] font-medium leading-4 tracking-[0.2px] text-gray-1000">{dev.link}</span>}
        </Item>
        <Sep />
        <Item
          tip={s.running ? 'Stop all instruments' : 'Run all instruments'}
          keys={['Space']}
          label={running ? 'Running, 4 instruments. Stop all' : 'Stopped. Run all'}
          onClick={() => {
            s.setRunning(!s.running)
            s.toast(s.running ? 'All instruments stopped' : 'All instruments running')
          }}
        >
          <span className={cn('size-2 flex-none rounded-full', running ? 'bg-blue-700 motion-safe:animate-[wf-pulse_1.6s_ease-out_infinite]' : 'bg-gray-600')} />
          <b className="font-medium text-gray-1000">{running ? 'Running' : 'Stopped'}</b>
          <span>{running ? '4 instruments' : 'All instruments idle'}</span>
        </Item>
        {dev && (
          <>
            <Sep className="max-[760px]:hidden" />
            <Item tip="Device temperature, limit 85 °C" className="max-[760px]:hidden">
              <Thermometer size={14} />
              <span className={mono}>41 °C</span>
            </Item>
            <Item tip="USB power used of the 2.50 W limit" to="supplies" className="max-[1100px]:hidden">
              <PlugZap size={14} />
              <span className={mono}>1.12 W / 2.50 W</span>
            </Item>
            <Item tip="Samples in the capture buffer" to="device-options" className="max-[1100px]:hidden">
              <Cpu size={14} />
              <span className={mono}>{cfg.scope} · {cfg.label}</span>
            </Item>
          </>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-0.5">
        <Item tip="Scripts type-check before they run" to="script" className="max-[760px]:hidden">
          <TypeScriptIcon size={14} />
          <span>TypeScript Ready</span>
          <Check size={14} className="text-blue-900" />
        </Item>
        {mcp.pending > 0 ? (
          <Item
            tip="An agent wants to change an output. Review it on MCP Server."
            to="mcp"
            label={`${mcp.pending} MCP approval pending, open MCP Server`}
            className="!bg-amber-200 !text-amber-900 shadow-[inset_0_0_0_1px_var(--amber-400)] hover:!bg-amber-300"
          >
            <TriangleAlert size={14} />
            <b className="font-medium">
              {mcp.pending} MCP {mcp.pending === 1 ? 'Approval' : 'Approvals'} Pending
            </b>
          </Item>
        ) : (
          <Item tip={mcp.on ? 'MCP server running' : 'MCP server stopped'} to="mcp" label={mcp.on ? `MCP server, ${mcp.clients} clients` : 'MCP server stopped'}>
            <ModelContextProtocolIcon size={14} />
            <b className="font-medium text-gray-1000">{mcp.on ? `MCP: ${mcp.clients} ${mcp.clients === 1 ? 'Client' : 'Clients'}` : 'MCP: Off'}</b>
          </Item>
        )}
      </div>
    </footer>
  )
}
