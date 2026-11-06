// App-wide shortcuts, as in the design: ⌘K search, ⌘S save, ⌘B sidebar, ⌘R run script, ⌘1–6 instruments,
// ⌘, Settings, ⇧⌘L flips light and dark, Space runs or stops everything when nothing has focus.
import { useEffect } from 'react'
import { pages } from '../routes'
import { useStore } from '../store'
import { useScript } from '../views/script-store'
import { useSidebarCollapsed } from './Sidebar'

export function useShortcuts(): void {
  const collapsed = useSidebarCollapsed()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
      if (mod && !e.shiftKey && k === 'k') {
        e.preventDefault()
        s.setSearchOpen(!s.searchOpen)
      } else if (mod && !e.shiftKey && k === 's') {
        e.preventDefault()
        s.toast('Workspace saved', { detail: s.workspace + '.oscillo' })
      } else if (mod && !e.shiftKey && k === 'b') {
        e.preventDefault()
        s.setSidebarCollapsed(!collapsed)
      } else if (mod && !e.shiftKey && k === 'r') {
        e.preventDefault()
        s.go('script')
        useScript.getState().runOrContinue()
      } else if (mod && e.shiftKey && k === 'l') {
        e.preventDefault()
        s.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
      } else if (mod && !e.shiftKey && !e.altKey) {
        const p = pages.find((x) => x.key === e.key)
        if (p) {
          e.preventDefault()
          s.go(p.id)
        }
      } else if (!mod && !typing && e.key === ' ' && (!t || t === document.body || t.tagName === 'MAIN' || t.tagName === 'SECTION')) {
        e.preventDefault()
        s.setRunning(!s.running)
        s.toast(s.running ? 'All instruments stopped' : 'All instruments running')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [collapsed])
}
