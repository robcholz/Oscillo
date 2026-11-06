// Mirrors the chosen theme onto <html data-theme> for the Geist tokens, following macOS on System,
// and tells the main process so the window chrome and background match.
import { useSyncExternalStore } from 'react'
import { useStore } from './store'

const query = window.matchMedia('(prefers-color-scheme: dark)')

function isDark(): boolean {
  const theme = useStore.getState().theme
  return theme === 'system' ? query.matches : theme === 'dark'
}

function subscribe(cb: () => void): () => void {
  query.addEventListener('change', cb)
  const off = useStore.subscribe((now, before) => {
    if (now.theme !== before.theme) cb()
  })
  return () => {
    query.removeEventListener('change', cb)
    off()
  }
}

const apply = (): void => {
  document.documentElement.dataset.theme = isDark() ? 'dark' : 'light'
  window.oscillo?.setTheme(useStore.getState().theme)
}
apply()
subscribe(apply)

export function useDark(): boolean {
  return useSyncExternalStore(subscribe, isDark)
}
