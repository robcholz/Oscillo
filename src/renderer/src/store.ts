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
  reducedMotion: boolean
}

interface Ephemeral {
  toasts: ToastItem[]
  searchOpen: boolean
  mcpPending: number
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
  setMcpPending: (n: number) => void
  setReducedMotion: (r: boolean) => void
  toast: (title: string, opts?: { detail?: string; action?: ToastItem['action'] }) => void
  dismissToast: (id: number) => void
}

export type State = Persisted & Ephemeral & Actions

let toastId = 0

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      page: 'scope',
      theme: 'system',
      sidebarCollapsed: null,
      device: 'AD3',
      running: true,
      workspace: 'Untitled',
      panels: {},
      reducedMotion: false,
      toasts: [],
      searchOpen: false,
      mcpPending: 1,
      go: (page) => set({ page }),
      setTheme: (theme) => set({ theme }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setDevice: (device) => set({ device }),
      setRunning: (running) => set({ running }),
      setWorkspace: (workspace) => set({ workspace }),
      setPanel: (id, p) => set({ panels: { ...get().panels, [id]: { ...{ width: 320, hidden: false }, ...get().panels[id], ...p } } }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setMcpPending: (mcpPending) => set({ mcpPending }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      toast: (title, opts) => {
        const id = ++toastId
        set({ toasts: [...get().toasts.slice(-2), { id, title, ...opts }] })
        setTimeout(() => get().dismissToast(id), 4000)
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
        reducedMotion: s.reducedMotion
      })
    }
  )
)
