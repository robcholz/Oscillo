// App preferences from Settings. Persisted on their own so "Reset Settings" can restore every default
// without touching the workspace, device or calibration.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const PREF_DEFAULTS = {
  fontSize: '13 px' as '13 px' | '14 px' | '16 px',
  animations: 'System' as 'System' | 'Reduced' | 'On',
  curve: 'Linear' as 'Linear' | 'Smooth',
  plotWidth: 1.5,
  wheel: 'Zoom' as 'Zoom' | 'Scroll',
  drag: 'Pan' as 'Pan' | 'Select Region',
  hover: true,
  decimal: 'Locale' as 'Locale' | 'Point' | 'Comma',
  onStart: 'Open Last Workspace',
  autoUpdate: true
}
export type Prefs = typeof PREF_DEFAULTS

export const usePrefs = create<Prefs & { set: (p: Partial<Prefs>) => void; reset: () => void }>()(
  persist((set) => ({ ...PREF_DEFAULTS, set: (p) => set(p), reset: () => set(PREF_DEFAULTS) }), {
    name: 'oscillo.prefs',
    partialize: ({ set: _s, reset: _r, ...rest }) => rest
  })
)
