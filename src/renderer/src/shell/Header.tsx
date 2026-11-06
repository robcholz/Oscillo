// The 56px title bar: traffic-light inset, sidebar toggle, device and workspace menus, search,
// then MCP status, Run All, theme and Settings. The bar itself drags the window.
import {
  Button, Input, Kbd, MenuButton, MenuGroup, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, Modal, StatusDot,
  ThemeSwitcher, Tooltip, cn
} from '@robcholz/geist'
import {
  Download, FolderOpen, Monitor, PanelLeftClose, PanelLeftOpen, Pencil, Play, Plug, Power, RadioTower, Ruler, Save, Search,
  Settings, SlidersHorizontal, Square, Usb
} from 'lucide-react'
import { useState } from 'react'
import { connectDevice, useDevice, useDevices, type DeviceId } from '../devices'
import { useStore } from '../store'
import { useMcpSummary } from '../views/mcp-store'
import { useSidebarCollapsed } from './Sidebar'

const deviceIcon = { USB: Usb, LAN: RadioTower, SIM: Monitor }

export function Header() {
  const s = useStore()
  const mcp = useMcpSummary()
  const collapsed = useSidebarCollapsed()
  const [rename, setRename] = useState<string | null>(null)
  const dev = useDevice()
  const list = useDevices((d) => d.list)

  const setDevice = (id: DeviceId | null): void => void connectDevice(id)
  const toggleRun = (): void => {
    s.setRunning(!s.running)
    s.toast(s.running ? 'All instruments stopped' : 'All instruments running')
  }
  const saveRename = (): void => {
    const n = (rename ?? '').trim() || 'Untitled'
    s.setWorkspace(n)
    setRename(null)
    s.toast('Workspace saved', { detail: n + '.oscillo' })
  }

  return (
    <header className="drag flex h-14 flex-none items-center justify-between gap-2 bg-background-100 py-2 pr-3 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* macOS draws the traffic lights here. */}
        <div className="h-full w-20 flex-none" aria-hidden="true" />
        <Button
          type="tertiary"
          size="small"
          svgOnly
          aria-label={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          tooltip
          tooltipKeys={['⌘', 'B']}
          tooltipPosition="bottom"
          onClick={() => s.setSidebarCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </Button>
        <MenuButton
          aria-label={dev ? 'Device: ' + dev.name : 'No device connected'}
          width={260}
          prefix={<StatusDot state={dev ? 'READY' : 'ERROR'} />}
          menu={
            <>
              <MenuGroup label="Devices">
                <MenuRadioGroup value={s.device ?? ''} onValueChange={(v) => v !== s.device && setDevice(v as DeviceId)}>
                  {list.map((d) => {
                    const Icon = deviceIcon[d.link]
                    return (
                      <MenuRadioItem key={d.id} value={d.id}>
                        <Icon size={16} className="flex-none text-gray-900" />
                        <span className="flex min-w-0 flex-col py-1.5">
                          <span className="truncate">{d.name}</span>
                          <span className="truncate font-mono text-xs text-gray-900">{d.serial}</span>
                        </span>
                      </MenuRadioItem>
                    )
                  })}
                </MenuRadioGroup>
              </MenuGroup>
              <MenuSeparator />
              <MenuItem prefix={<Usb size={16} />} onSelect={() => s.go('device')}>Device Manager</MenuItem>
              <MenuItem prefix={<SlidersHorizontal size={16} />} onSelect={() => s.go('device-options')}>Device Options</MenuItem>
              <MenuItem prefix={<Ruler size={16} />} onSelect={() => s.go('calibration')}>Calibration</MenuItem>
              <MenuSeparator />
              {s.device ? (
                <MenuItem danger prefix={<Power size={16} />} onSelect={() => setDevice(null)}>Disconnect</MenuItem>
              ) : (
                <MenuItem prefix={<Plug size={16} />} onSelect={() => setDevice('AD3')}>Connect Analog Discovery 3</MenuItem>
              )}
            </>
          }
        >
          <span className="font-medium">{dev ? dev.name : 'No Device'}</span>
          <span className="ml-2 font-mono text-xs text-gray-900 max-[1180px]:hidden">{dev ? dev.serial : 'Disconnected'}</span>
        </MenuButton>
        <MenuButton
          type="tertiary"
          aria-label="Workspace"
          width={260}
          className="max-[1060px]:hidden"
          menu={
            <>
              <MenuItem prefix={<Save size={16} />} shortcut={['⌘', 'S']} onSelect={() => s.toast('Workspace saved', { detail: s.workspace + '.oscillo' })}>
                Save Workspace
              </MenuItem>
              <MenuItem prefix={<Save size={16} />} onSelect={() => setRename(s.workspace)}>Save Workspace As…</MenuItem>
              <MenuItem prefix={<Pencil size={16} />} onSelect={() => setRename(s.workspace)}>Rename…</MenuItem>
              <MenuSeparator />
              <MenuItem prefix={<FolderOpen size={16} />} onSelect={() => s.go('welcome')}>Open Workspace…</MenuItem>
              <MenuItem prefix={<Download size={16} />} onSelect={() => s.go('export')}>Export and Logging</MenuItem>
            </>
          }
        >
          <span className="text-[13px] leading-4 text-gray-900">Workspace: {s.workspace}</span>
        </MenuButton>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label="Search instruments and commands"
          onClick={() => s.setSearchOpen(true)}
          className="flex h-8 w-60 cursor-pointer items-center gap-2 rounded-small bg-transparent pl-2.5 pr-1.5 text-left text-sm text-gray-900 shadow-[0_0_0_1px_var(--gray-alpha-400)] hover:shadow-[0_0_0_1px_var(--gray-alpha-500)] max-[1360px]:w-44 max-[1220px]:w-8 max-[1220px]:justify-center max-[1220px]:px-0 kbd-focus:shadow-focus-ring"
        >
          <Search size={16} className="flex-none" />
          <span className="flex-1 max-[1220px]:hidden">Search…</span>
          <Kbd small className="max-[1220px]:hidden">⌘K</Kbd>
        </button>
      </div>
      <div className="flex flex-none items-center gap-2">
        <Tooltip
          position="bottom"
          text={mcp.pending ? 'An agent request is waiting for your approval' : mcp.on ? `MCP server running, ${mcp.clients} ${mcp.clients === 1 ? 'client' : 'clients'} connected` : 'MCP server stopped'}
        >
          <button
            type="button"
            onClick={() => s.go('mcp')}
            aria-label={mcp.pending ? `MCP, ${mcp.pending} request pending approval` : mcp.on ? `MCP, ${mcp.clients} clients connected` : 'MCP, server stopped'}
            className={cn(
              'flex h-8 cursor-pointer items-center gap-2 rounded-small px-2.5 text-sm text-gray-1000 kbd-focus:shadow-focus-ring',
              mcp.pending
                ? 'bg-amber-100 shadow-[0_0_0_1px_var(--amber-400)] hover:bg-amber-200'
                : 'shadow-[0_0_0_1px_var(--gray-alpha-400)] hover:bg-gray-alpha-100'
            )}
          >
            <StatusDot state={mcp.pending ? 'BUILDING' : mcp.on ? 'READY' : 'QUEUED'} />
            <span className="font-medium">MCP</span>
            <span className={cn('max-[1220px]:hidden', mcp.pending ? 'font-medium text-amber-900' : 'text-gray-900')}>
              {mcp.pending ? mcp.pending + ' Pending' : mcp.on ? `${mcp.clients} ${mcp.clients === 1 ? 'Client' : 'Clients'}` : 'Off'}
            </span>
          </button>
        </Tooltip>
        <Button
          type={s.running ? 'secondary' : 'primary'}
          size="small"
          prefix={s.running ? <Square size={16} /> : <Play size={16} />}
          aria-pressed={s.running}
          tooltip={s.running ? 'Stop all instruments' : 'Run all instruments'}
          tooltipKeys={['Space']}
          tooltipPosition="bottom"
          onClick={toggleRun}
        >
          {s.running ? 'Stop All' : 'Run All'}
        </Button>
        <ThemeSwitcher value={s.theme} onChange={s.setTheme} />
        <Button type="secondary" size="small" svgOnly aria-label="Settings" tooltip tooltipKeys={['⌘', ',']} tooltipPosition="bottom" onClick={() => s.go('settings')}>
          <Settings size={16} />
        </Button>
      </div>
      <Modal
        open={rename !== null}
        onClose={() => setRename(null)}
        title="Rename Workspace"
        onSubmit={saveRename}
        actions={
          <>
            <Button type="secondary" size="small" onClick={() => setRename(null)}>
              Cancel
            </Button>
            <Button size="small" typeName="submit">
              Save Workspace
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="ws-name" className="text-[13px] leading-4 text-gray-900">
            Workspace Name
          </label>
          <Input id="ws-name" size="small" autoFocus value={rename ?? ''} onChange={(e) => setRename(e.target.value)} />
        </div>
      </Modal>
    </header>
  )
}
