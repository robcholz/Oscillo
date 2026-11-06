// App-wide shortcuts, as in the design: ⌘K search, ⌘S save, ⌘O open, ⌘B sidebar, ⌘R run script, ⌘1–6
// instruments, ⌘, Settings, ⇧⌘L light and dark, ⌘↵ Single and ⇧⌘A Auto Set on the Scope, ⌥⌘0 the
// settings panel, ⌘Z and ⇧⌘Z in editors. In the app they arrive from the menu bar (src/main/menu.ts);
// Space runs or stops everything when nothing has focus.
import { useEffect } from 'react'
import type { AppCommand } from '../../../shared/commands'
import { pageById, pages, type PageId } from '../routes'
import { useStore } from '../store'
import { files } from '../files'
import { REPO } from '../updates'
import { useScript } from '../views/script-store'
import { openWorkspace, saveWorkspace } from '../workspace'
import { commandForKey, runPageCommand } from './commands'
import { useSidebarCollapsed } from './Sidebar'

export function useShortcuts(): void {
  const collapsed = useSidebarCollapsed()
  useEffect(() => {
    const run = (cmd: AppCommand): void => {
      const s = useStore.getState()
      if (cmd.startsWith('page:')) {
        const id = cmd.slice(5) as PageId
        if (pageById[id]) s.go(id)
        return
      }
      switch (cmd) {
        case 'settings':
          return s.go('settings')
        case 'search':
          return s.setSearchOpen(!s.searchOpen)
        case 'save-workspace':
          return void saveWorkspace()
        case 'open-workspace':
          return void openWorkspace()
        case 'toggle-sidebar':
          return s.setSidebarCollapsed(!collapsed)
        case 'toggle-theme':
          return s.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
        case 'run-script':
          s.go('script')
          return useScript.getState().runOrContinue()
        case 'docs':
          return void files?.external(`https://github.com/${REPO}#readme`)
        case 'report-issue':
          return void files?.external(`https://github.com/${REPO}/issues/new`)
        case 'about':
        case 'check-updates':
        case 'feedback':
        case 'shortcuts':
        case 'single':
        case 'auto-set':
          // Page commands: open their page first when another page is showing.
          if (!runPageCommand(cmd)) {
            s.go(cmd === 'single' || cmd === 'auto-set' ? 'scope' : 'settings')
            setTimeout(() => runPageCommand(cmd), 0)
          }
          return
        default:
          runPageCommand(cmd)
      }
    }
    const bridge = window.oscillo
    const off = bridge?.onCommand(run)
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
      if (!bridge) {
        // No menu bar (plain browser): read the shortcuts from the keyboard.
        const cmd = commandForKey(e)
        if (cmd && !(typing && (cmd === 'undo' || cmd === 'redo'))) {
          e.preventDefault()
          return run(cmd)
        }
        const p = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && pages.find((x) => x.key === e.key)
        if (p) {
          e.preventDefault()
          return useStore.getState().go(p.id)
        }
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !typing && e.key === ' ' && (!t || t === document.body || t.tagName === 'MAIN' || t.tagName === 'SECTION')) {
        e.preventDefault()
        const s = useStore.getState()
        s.setRunning(!s.running)
        s.toast(s.running ? 'All instruments stopped' : 'All instruments running')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      off?.()
      document.removeEventListener('keydown', onKey)
    }
  }, [collapsed])
}
