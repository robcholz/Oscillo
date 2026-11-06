// Workspace files: every instrument's settings (their persisted stores) in one .oscillo JSON file,
// optionally with each instrument's latest capture. Opening one swaps the settings in and reloads.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { deviceById } from './devices'
import { files, INSTRUMENTS, latestOf, publish, toCsv, type Instrument, type Table } from './files'
import type { PageId } from './routes'
import { useStore } from './store'

/** Stores that belong to the app, not to a workspace. */
const APP_KEYS = new Set(['oscillo', 'oscillo.prefs', 'oscillo.mcp', 'oscillo.devices', 'oscillo.device-options', 'oscillo.export', 'oscillo.recent', 'oscillo.calibration'])
const isInstrumentKey = (k: string) => k.startsWith('oscillo.') && !APP_KEYS.has(k)

export interface WorkspaceFile {
  app: 'Oscillo'
  kind: 'workspace' | 'project'
  version: 1
  name: string
  device: string
  saved: string
  page: PageId
  state: Record<string, unknown>
  data?: Partial<Record<Instrument, { columns: string[]; data: number[][]; at: number }>>
}

export interface Recent {
  name: string
  path: string
  device: string
  at: number
}

interface RecentState {
  /** The file the open workspace was last saved to or opened from. */
  path: string | null
  recent: Recent[]
}
export const useRecent = create<RecentState>()(persist((): RecentState => ({ path: null, recent: [] }), { name: 'oscillo.recent' }))

const remember = (name: string, path: string) => {
  const r = useRecent.getState()
  const app = useStore.getState()
  const device = deviceById(app.device)?.name ?? 'No Device'
  useRecent.setState({ path, recent: [{ name, path, device, at: Date.now() }, ...r.recent.filter((x) => x.path !== path)].slice(0, 12) })
}

const read = (k: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null')
  } catch {
    return null
  }
}

/** Store keys for one page (its project). */
const keysOf = (page: PageId): string[] => (page === 'static-io' ? ['oscillo.static-io'] : [`oscillo.${page}`]).filter((k) => localStorage.getItem(k) !== null)

/** The open workspace as a file. */
export function snapshot(withData: boolean, only?: PageId): WorkspaceFile {
  const app = useStore.getState()
  const state: Record<string, unknown> = {}
  const keys = only ? keysOf(only) : Object.keys(localStorage).filter(isInstrumentKey)
  for (const k of keys) state[k] = read(k)
  const data: WorkspaceFile['data'] = {}
  if (withData)
    for (const i of INSTRUMENTS) {
      const t = latestOf(i)
      if (t) data[i] = { columns: t.columns, data: t.data.map((c) => Array.from(c)), at: t.at }
    }
  return {
    app: 'Oscillo',
    kind: only ? 'project' : 'workspace',
    version: 1,
    name: app.workspace,
    device: deviceById(app.device)?.name ?? 'No Device',
    saved: new Date().toISOString(),
    page: only ?? app.page,
    state,
    ...(withData && Object.keys(data).length ? { data } : {})
  }
}

const toast = (t: string, detail?: string) => useStore.getState().toast(t, { detail })
const plain = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const withData = (): boolean => (read('oscillo.export') as { state?: { withData?: boolean } } | null)?.state?.withData ?? true

/** ⌘S: writes to the workspace's file, asking where the first time (or always with `as`). */
export async function saveWorkspace(opts: { as?: boolean; name?: string } = {}): Promise<boolean> {
  if (!files) return false
  const app = useStore.getState()
  if (opts.name) app.setWorkspace(opts.name)
  const name = useStore.getState().workspace
  const ws = snapshot(withData())
  const text = JSON.stringify(ws, null, 1)
  try {
    const cur = useRecent.getState().path
    const path = !opts.as && cur && cur.split(/[\\/]/).pop() === `${name}.oscillo` ? await files.write(cur, text) : await files.save(`${name}.oscillo`, text, [{ name: 'Oscillo Workspace', extensions: ['oscillo'] }], '~/Documents/Oscillo/Workspaces')
    if (!path) return false
    const saved = path.split(/[\\/]/).pop()!.replace(/\.oscillo$/, '')
    if (saved !== name) app.setWorkspace(saved)
    remember(saved, path)
    useStore.getState().toast('Workspace saved', { detail: path, action: { label: 'Show', run: () => void files?.reveal(path) } })
    return true
  } catch (e) {
    toast('Could not save the workspace', plain(e))
    return false
  }
}

/** Saves only the page's settings as a .oscproj. */
export async function saveProject(page: PageId): Promise<void> {
  if (!files) return
  const p = snapshot(false, page)
  if (!Object.keys(p.state).length) return toast('Nothing to save yet', 'This page has no settings of its own. Change one first.')
  try {
    const path = await files.save(`${page}.oscproj`, JSON.stringify(p, null, 1), [{ name: 'Oscillo Project', extensions: ['oscproj'] }], '~/Documents/Oscillo/Workspaces')
    if (path) useStore.getState().toast(`Saved ${path.split(/[\\/]/).pop()}`, { detail: 'Settings of this instrument only.', action: { label: 'Show', run: () => void files?.reveal(path) } })
  } catch (e) {
    toast('Could not save the project', plain(e))
  }
}

export function parseWorkspace(text: string): WorkspaceFile {
  let w: WorkspaceFile
  try {
    w = JSON.parse(text)
  } catch {
    throw new Error('This is not an Oscillo workspace or project file')
  }
  if (w?.app !== 'Oscillo' || typeof w.state !== 'object') throw new Error('This is not an Oscillo workspace or project file')
  return w
}

const DATA_KEY = 'oscillo-ws-data'

/** Swaps the file's settings in and reloads the window so every page picks them up. */
function load(w: WorkspaceFile, path: string): void {
  if (w.kind === 'workspace') for (const k of Object.keys(localStorage).filter(isInstrumentKey)) localStorage.removeItem(k)
  for (const [k, v] of Object.entries(w.state)) if (isInstrumentKey(k)) localStorage.setItem(k, JSON.stringify(v))
  if (w.kind === 'workspace') {
    useStore.setState({ workspace: w.name, page: w.page })
    remember(w.name, path)
    try {
      if (w.data) sessionStorage.setItem(DATA_KEY, JSON.stringify(w.data))
      else sessionStorage.removeItem(DATA_KEY)
    } catch {
      /* too large for session storage: the settings still load */
    }
  } else useStore.setState({ page: w.page })
  sessionStorage.setItem('oscillo-opened', `${w.kind === 'workspace' ? 'Opened' : 'Loaded'} ${path.split(/[\\/]/).pop()}`)
  location.reload()
}

/** Opens a workspace or project, from a path or by asking. */
export async function openWorkspace(path?: string): Promise<void> {
  if (!files) return
  try {
    let text: string
    if (path) text = await files.read(path)
    else {
      const f = await files.open([{ name: 'Oscillo Workspace or Project', extensions: ['oscillo', 'oscproj'] }])
      if (!f) return
      text = f.text
      path = f.path
    }
    load(parseWorkspace(text), path)
  } catch (e) {
    if (path) useRecent.setState({ recent: useRecent.getState().recent.filter((r) => r.path !== path) })
    toast('Could not open the workspace', plain(e))
  }
}

/** A fresh workspace: instrument settings back to their defaults. */
export function newWorkspace(name: string): void {
  for (const k of Object.keys(localStorage).filter(isInstrumentKey)) localStorage.removeItem(k)
  useStore.setState({ workspace: name, page: 'scope' })
  useRecent.setState({ path: null })
  sessionStorage.removeItem(DATA_KEY)
  sessionStorage.setItem('oscillo-opened', `Created ${name}`)
  location.reload()
}

/** After a reload from openWorkspace: republish saved captures and say what opened. */
export function restoreOpened(): void {
  try {
    const d = JSON.parse(sessionStorage.getItem(DATA_KEY) ?? 'null') as WorkspaceFile['data'] | null
    sessionStorage.removeItem(DATA_KEY)
    if (d) for (const [i, t] of Object.entries(d)) publish(i as Instrument, { columns: t.columns, data: t.data, at: t.at })
    const msg = sessionStorage.getItem('oscillo-opened')
    sessionStorage.removeItem('oscillo-opened')
    if (msg) setTimeout(() => toast(msg), 300)
  } catch {
    /* nothing to restore */
  }
}

/** Unpacks the workspace into a folder: one settings JSON per instrument and a CSV per capture. */
export async function extractWorkspace(): Promise<void> {
  if (!files) return
  const dir = await files.folder('~/Documents/Oscillo')
  if (!dir) return
  const ws = snapshot(true)
  const base = `${dir}/${ws.name}`
  try {
    for (const [k, v] of Object.entries(ws.state)) await files.write(`${base}/${k.replace(/^oscillo\./, '')}.json`, JSON.stringify(v, null, 1))
    for (const [i, t] of Object.entries(ws.data ?? {})) await files.write(`${base}/${i.toLowerCase().replace(/\s+/g, '-')}.csv`, toCsv(t as Table))
    useStore.getState().toast('Workspace extracted', { detail: base, action: { label: 'Show', run: () => void files?.reveal(base) } })
  } catch (e) {
    toast('Could not extract the workspace', plain(e))
  }
}

/** Flattens settings to dotted paths for comparing. */
function flatten(v: unknown, at: string, out: Map<string, string>): void {
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) flatten(x, at ? `${at}.${k}` : k, out)
  else out.set(at, JSON.stringify(v))
}

export interface Difference {
  setting: string
  a: string
  b: string
}

/** The settings that differ between the open workspace and a file the user picks. */
export async function compareWithFile(): Promise<{ name: string; diffs: Difference[] } | null> {
  if (!files) return null
  const f = await files.open([{ name: 'Oscillo Workspace', extensions: ['oscillo', 'oscproj'] }])
  if (!f) return null
  try {
    const other = parseWorkspace(f.text)
    const a = new Map<string, string>()
    const b = new Map<string, string>()
    const mine = snapshot(false).state
    const keys = other.kind === 'project' ? Object.keys(other.state) : [...new Set([...Object.keys(mine), ...Object.keys(other.state)])]
    for (const k of keys) {
      flatten((mine[k] as { state?: unknown })?.state ?? mine[k], k.replace(/^oscillo\./, ''), a)
      flatten((other.state[k] as { state?: unknown })?.state ?? other.state[k], k.replace(/^oscillo\./, ''), b)
    }
    const diffs: Difference[] = []
    for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const x = a.get(k) ?? '—'
      const y = b.get(k) ?? '—'
      if (x !== y) diffs.push({ setting: k, a: x.length > 40 ? x.slice(0, 39) + '…' : x, b: y.length > 40 ? y.slice(0, 39) + '…' : y })
    }
    return { name: f.name, diffs }
  } catch (e) {
    toast('Could not compare', plain(e))
    return null
  }
}
