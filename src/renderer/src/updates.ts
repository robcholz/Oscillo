// Release checks against GitHub, from Settings and once a day at launch.
import { files } from './files'
import { usePrefs } from './prefs'
import { useStore } from './store'

export const REPO = 'robcholz/Oscillo'

const newer = (tag: string, cur: string): boolean => {
  const a = tag.replace(/^v/, '').split('.').map(Number)
  const b = cur.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

export async function checkRelease(): Promise<{ tag: string; url: string; newer: boolean } | { error: string }> {
  if (!files) return { error: 'Updates are checked in the desktop app.' }
  const [r, v] = await Promise.all([files.release(), files.version()])
  return 'error' in r ? r : { ...r, newer: newer(r.tag, v.app) }
}

const KEY = 'oscillo-last-update-check'
/** At launch: checks once a day when Check Automatically is on, and says so only when there is a new version. */
export async function checkAtLaunch(): Promise<void> {
  if (!usePrefs.getState().autoUpdate) return
  const last = Number(localStorage.getItem(KEY) ?? 0)
  if (Date.now() - last < 864e5) return
  localStorage.setItem(KEY, String(Date.now()))
  const r = await checkRelease()
  if ('newer' in r && r.newer) useStore.getState().toast(`Oscillo ${r.tag.replace(/^v/, '')} is available`, { action: { label: 'Download', run: () => void files?.external(r.url) } })
}
