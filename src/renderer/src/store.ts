// App-wide state. Preferences and the last page persist in localStorage; toasts and dialogs don't.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemePref, ToastItem } from '@robcholz/geist'
import type { DeviceId } from './devices'
import type { PageId } from './routes'

export interface PanelPref {
  width: number
  hidden: boolean
}

interface Persisted {
  page: PageId
  theme: ThemePref
  /** null follows the window width (collapsed under 1100px). */
  sidebarCollapsed: boolean | null
  device: DeviceId | null
  running: boolean
  workspace: string
  panels: Record<string, PanelPref>
  /** Device buffer configuration, '1' to '4'. */
  config: string
}

interface Ephemeral {
  toasts: ToastItem[]
  searchOpen: boolean
}

interface Actions {
  go: (page: PageId) => void
  setTheme: (theme: ThemePref) => void
  setSidebarCollapsed: (c: boolean) => void
  setDevice: (d: DeviceId | null) => void
  setRunning: (r: boolean) => void
  setWorkspace: (w: string) => void
  setPanel: (id: string, p: Partial<PanelPref>) => void
  setSearchOpen: (o: boolean) => void
  setConfig: (c: string) => void
  toast: (title: string, opts?: { detail?: string; action?: ToastItem['action']; type?: ToastItem['type'] }) => void
  dismissToast: (id: number) => void
}

export type State = Persisted & Ephemeral & Actions

let toastId = 0

/** The colour a toast gets when the caller does not say: failures are errors, lost or refused
 * things are warnings, finished files and programming are successes, the rest stay plain. */
export function toastType(title: string): ToastItem['type'] {
  if (/\b(could not|cannot|can't|failed)\b|^no bitstream|^dmm stopped/i.test(title)) return 'error'
  if (/\b(disconnected|unplugged|not available|lost|denied|in use|overlap|already running|is the limit|must be|needs the desktop app|problems?)\b|^(no|nothing)\b|^wait for/i.test(title)) return 'warning'
  if (/^(exported|saved|imported|programmed|paired|extracted|workspace (saved|extracted)|calibration saved)\b/i.test(title)) return 'success'
  return undefined
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      page: 'scope',
      theme: 'system',
      sidebarCollapsed: null,
      device: 'DEMO',
      running: true,
      workspace: 'Untitled',
      panels: {},
      config: '1',
      toasts: [],
      searchOpen: false,
      go: (page) => set({ page }),
      setTheme: (theme) => set({ theme }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setDevice: (device) => set({ device }),
      setRunning: (running) => set({ running }),
      setWorkspace: (workspace) => set({ workspace }),
      setPanel: (id, p) => set({ panels: { ...get().panels, [id]: { ...{ width: 320, hidden: false }, ...get().panels[id], ...p } } }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setConfig: (config) => set({ config }),
      toast: (title, opts) => {
        const id = ++toastId
        const type = opts?.type ?? toastType(title)
        set({ toasts: [...get().toasts.slice(-2), { id, title, ...opts, type }] })
        // Problems stay up longer, so there is time to read the fix.
        setTimeout(() => get().dismissToast(id), type === 'error' || type === 'warning' ? 8000 : 4000)
      },
      dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
    }),
    {
      name: 'oscillo',
      version: 1,
      partialize: (s): Persisted => ({
        page: s.page,
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        device: s.device,
        running: s.running,
        workspace: s.workspace,
        panels: s.panels,
        config: s.config
      })
    }
  )
)
