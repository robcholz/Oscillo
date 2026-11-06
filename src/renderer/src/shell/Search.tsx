// ⌘K: every page plus the app-wide commands.
import { CommandMenu, type CommandItem } from '@robcholz/geist'
import { Keyboard, Monitor, Moon, PanelLeft, Play, Plug, Power, Save, Square, Sun } from 'lucide-react'
import { pages } from '../routes'
import { useStore } from '../store'
import { useSidebarCollapsed } from './Sidebar'

const groupOf = { Workspace: 'Workspace', Instruments: 'Instruments', Analysis: 'Analysis', Automation: 'Workspace', App: 'Workspace' } as const

export function Search() {
  const s = useStore()
  const collapsed = useSidebarCollapsed()
  const nav: CommandItem[] = (['Instruments', 'Analysis', 'Workspace'] as const).flatMap((g) =>
    pages
      .filter((p) => groupOf[p.group] === g)
      .map((p) => {
        const Icon = p.icon
        return { id: p.id, group: g, label: p.title, keywords: p.keywords, icon: <Icon size={16} />, keys: p.key ? ['⌘', p.key] : undefined, run: () => s.go(p.id) }
      })
  )
  const commands: CommandItem[] = [
    {
      id: 'run',
      group: 'Commands',
      label: s.running ? 'Stop All Instruments' : 'Run All Instruments',
      icon: s.running ? <Square size={16} /> : <Play size={16} />,
      run: () => {
        s.setRunning(!s.running)
        s.toast(s.running ? 'All instruments stopped' : 'All instruments running')
      }
    },
    { id: 'save', group: 'Commands', label: 'Save Workspace', icon: <Save size={16} />, keys: ['⌘', 'S'], run: () => s.toast('Workspace saved', { detail: s.workspace + '.oscillo' }) },
    s.device
      ? { id: 'disconnect', group: 'Commands', label: 'Disconnect Device', icon: <Power size={16} />, run: () => s.setDevice(null) }
      : { id: 'connect', group: 'Commands', label: 'Connect Analog Discovery 3', icon: <Plug size={16} />, run: () => s.setDevice('AD3') },
    { id: 'shortcuts', group: 'Commands', label: 'Keyboard Shortcuts', icon: <Keyboard size={16} />, keywords: 'keys hotkeys', run: () => s.go('settings') },
    { id: 'sidebar', group: 'Commands', label: collapsed ? 'Expand Sidebar' : 'Collapse Sidebar', icon: <PanelLeft size={16} />, keys: ['⌘', 'B'], run: () => s.setSidebarCollapsed(!collapsed) },
    { id: 'light', group: 'Commands', label: 'Light Theme', icon: <Sun size={16} />, keywords: 'appearance mode', run: () => s.setTheme('light') },
    { id: 'dark', group: 'Commands', label: 'Dark Theme', icon: <Moon size={16} />, keywords: 'appearance mode', run: () => s.setTheme('dark') },
    { id: 'system', group: 'Commands', label: 'System Theme', icon: <Monitor size={16} />, keywords: 'appearance mode auto', run: () => s.setTheme('system') }
  ]
  return (
    <CommandMenu
      open={s.searchOpen}
      setOpen={s.setSearchOpen}
      items={[...nav, ...commands]}
      placeholder="Search instruments, settings and commands…"
      emptyHint="Try an instrument, “fft” or “theme”."
      description="Search instruments, settings and commands"
    />
  )
}
