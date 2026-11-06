// App preferences from Settings. Persisted on their own so "Reset Settings" can restore every default
// without touching the workspace, device or calibration.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const PREF_DEFAULTS = {
  windows: 'Tabs' as 'Tabs' | 'Docking' | 'Separate Windows',
  fontSize: '13 px' as '13 px' | '14 px' | '16 px',
  animations: 'System' as 'System' | 'Reduced' | 'On',
  curve: 'Linear' as 'Linear' | 'Smooth',
  plotWidth: 1.5,
  wheel: 'Zoom' as 'Zoom' | 'Scroll',
  drag: 'Pan' as 'Pan' | 'Select Region',
  hover: true,
  language: 'English',
  decimal: 'Locale' as 'Locale' | 'Point' | 'Comma',
  grouping: '1,000,000',
  listSep: 'Comma',
  onStart: 'Open Last Workspace',
  associate: true,
  multiInstance: false,
  autoUpdate: true
}
export type Prefs = typeof PREF_DEFAULTS

export const usePrefs = create<Prefs & { set: (p: Partial<Prefs>) => void; reset: () => void }>()(
  persist((set) => ({ ...PREF_DEFAULTS, set: (p) => set(p), reset: () => set(PREF_DEFAULTS) }), {
    name: 'oscillo.prefs',
    partialize: ({ set: _s, reset: _r, ...rest }) => rest
  })
)
