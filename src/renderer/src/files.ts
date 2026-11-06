// Saving and opening files from instrument pages: CSV tables, window images, and the latest
// capture of each instrument (published by the pages, read by Export, Logging and workspaces).
import { useSyncExternalStore } from 'react'
import type { Filter } from '../../shared/files'
import type { PageId } from './routes'
import { useStore } from './store'

export const files = typeof window !== 'undefined' ? (window.oscillo?.files ?? null) : null

/** A capture as columns: the first column is the x axis (time or frequency). */
export interface Table {
  columns: string[]
  data: ArrayLike<number>[]
  /** When the capture was taken (ms since epoch). */
  at: number
  triggered?: boolean
  /** Settings written as comments above the data. */
  meta?: Record<string, string>
}

export type Instrument = 'Oscilloscope' | 'Logic Analyzer' | 'Spectrum' | 'Network' | 'Impedance' | 'Logger' | 'Protocol'
export const INSTRUMENTS: Instrument[] = ['Oscilloscope', 'Logic Analyzer', 'Spectrum', 'Network', 'Impedance', 'Logger']

const latest = new Map<Instrument, Table>()
const subs = new Set<(i: Instrument, t: Table) => void>()

/** Called by a page each time it has a new capture. */
export function publish(i: Instrument, t: Omit<Table, 'at'> & { at?: number }): void {
  const full = { at: Date.now(), ...t }
  latest.set(i, full)
  for (const f of subs) f(i, full)
}
export const latestOf = (i: Instrument): Table | null => latest.get(i) ?? null
export function onPublish(f: (i: Instrument, t: Table) => void): () => void {
  subs.add(f)
  return () => subs.delete(f)
}

export interface CsvOpts {
  format?: 'CSV' | 'TXT'
  /** Seconds keeps the x column; Sample Index numbers rows; Clock Time stamps each row. */
  time?: 'Seconds' | 'Sample Index' | 'Clock Time'
  decimal?: 'Locale' | 'Point'
  header?: boolean
  comments?: Record<string, string> | null
  notes?: string
  /** Column names to keep (the x column always stays). */
  only?: string[]
}

/** Formats a table as CSV or tab-separated text. */
export function toCsv(t: Table, o: CsvOpts = {}): string {
  const comma = o.decimal === 'Locale' && (0.5).toLocaleString().includes(',')
  const sep = o.format === 'TXT' ? '\t' : comma ? ';' : ','
  const num = (v: number) => {
    const s = Number.isInteger(v) ? String(v) : Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(6) : String(+v.toPrecision(9))
    return comma ? s.replace('.', ',') : s
  }
  const keep = t.columns.map((c, i) => i === 0 || !o.only || o.only.includes(c))
  const cols = t.columns.filter((_, i) => keep[i])
  const data = t.data.filter((_, i) => keep[i])
  const out: string[] = []
  if (o.comments) for (const [k, v] of Object.entries(o.comments)) out.push(`# ${k}: ${v}`)
  if (o.notes) for (const l of o.notes.split('\n')) out.push(`# ${l}`)
  const time = o.time ?? 'Seconds'
  const xName = time === 'Sample Index' ? 'Sample' : time === 'Clock Time' ? 'Time' : cols[0]
  if (o.header !== false) out.push([xName, ...cols.slice(1)].join(sep))
  const n = data[0]?.length ?? 0
  for (let r = 0; r < n; r++) {
    const x = time === 'Sample Index' ? String(r) : time === 'Clock Time' ? new Date(t.at + data[0][r] * 1000).toISOString() : num(data[0][r])
    const row = [x]
    for (let c = 1; c < data.length; c++) row.push(num(data[c][r]))
    out.push(row.join(sep))
  }
  return out.join('\n') + '\n'
}

/** Parses CSV or tab-separated numbers, skipping comments and a header. */
export function parseCsv(text: string): { columns: string[]; data: number[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'))
  const sep = lines[0]?.includes('\t') ? '\t' : lines[0]?.includes(';') ? ';' : ','
  const split = (l: string) => l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''))
  let columns: string[] = []
  if (lines.length && split(lines[0]).some((x) => x !== '' && Number.isNaN(Number(x.replace(',', '.'))))) columns = split(lines.shift()!)
  const rows = lines.map((l) => split(l).map((x) => Number(sep === ';' ? x.replace(',', '.') : x)))
  const width = Math.max(0, ...rows.map((r) => r.length))
  if (!columns.length) columns = Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
  const data = Array.from({ length: width }, (_, c) => rows.map((r) => r[c]).filter((v) => Number.isFinite(v)))
  return { columns, data }
}

const plain = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const done = (path: string, detail?: string) => useStore.getState().toast(`Saved ${path.split(/[\\/]/).pop()}`, { detail, action: files ? { label: 'Show', run: () => void files.reveal(path) } : undefined })
const failed = (e: unknown) => useStore.getState().toast('Could not save', { detail: plain(e) })

const CSV: Filter[] = [{ name: 'CSV', extensions: ['csv', 'txt'] }]

/** Asks where to save a table and writes it. Returns the path, or null when cancelled. */
export async function saveTable(name: string, t: Table | null, o: CsvOpts = {}): Promise<string | null> {
  const toast = useStore.getState().toast
  if (!t || !t.data[0]?.length) {
    toast('Nothing to export yet', { detail: 'Run the instrument to capture data first.' })
    return null
  }
  if (!files) return null
  try {
    const p = await files.save(name, toCsv(t, o), o.format === 'TXT' ? [{ name: 'Text', extensions: ['txt'] }] : CSV)
    if (p) done(p, `${t.data[0].length.toLocaleString()} rows.`)
    return p
  } catch (e) {
    failed(e)
    return null
  }
}

/** Saves text the page already formatted. */
export async function saveText(name: string, text: string, filters: Filter[] = CSV): Promise<string | null> {
  if (!files) return null
  try {
    const p = await files.save(name, text, filters)
    if (p) done(p)
    return p
  } catch (e) {
    failed(e)
    return null
  }
}

/** Saves a PNG of the window. */
export async function saveImage(name: string, o: Parameters<typeof captureView>[0] = {}): Promise<string | null> {
  if (!files) return null
  try {
    const png = await captureView(o)
    const p = await files.save(name, png, [{ name: 'PNG Image', extensions: ['png'] }])
    if (p) done(p)
    return p
  } catch (e) {
    failed(e)
    return null
  }
}

/** Asks for a CSV and parses it. */
export async function openTable(): Promise<{ name: string; columns: string[]; data: number[][] } | null> {
  if (!files) return null
  try {
    const f = await files.open(CSV)
    if (!f) return null
    const t = parseCsv(f.text)
    if (!t.data.length || !t.data[0].length) throw new Error(`${f.name} has no numbers in it`)
    return { name: f.name, ...t }
  } catch (e) {
    useStore.getState().toast('Could not open the file', { detail: plain(e) })
    return null
  }
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const PAGE_OF: Record<Instrument, PageId> = { Oscilloscope: 'scope', 'Logic Analyzer': 'logic', Spectrum: 'spectrum', Network: 'network', Impedance: 'impedance', Logger: 'logger', Protocol: 'protocol' }
export const pageOf = (i: Instrument): PageId => PAGE_OF[i]

/**
 * A PNG of an instrument page: shows the page (in another theme if asked), captures the window,
 * puts everything back, and stamps the device and time in the corner with `overlay`.
 */
export async function captureView(o: { page?: PageId; theme?: 'Current' | 'Light' | 'Dark'; overlay?: string | null } = {}): Promise<Uint8Array> {
  if (!files) throw new Error('Images need the desktop app')
  const s = useStore.getState()
  const page = s.page
  const theme = s.theme
  try {
    if (o.page && o.page !== page) s.go(o.page)
    if (o.theme && o.theme !== 'Current') useStore.setState({ theme: o.theme === 'Dark' ? 'dark' : 'light' })
    if (o.page !== page || (o.theme && o.theme !== 'Current')) {
      await frame()
      await new Promise((r) => setTimeout(r, 350))
      await frame()
    }
    const png = await files.capture()
    if (!o.overlay) return png
    const img = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const scale = img.width / window.innerWidth
    g.font = `${12 * scale}px ui-monospace, SFMono-Regular, Menlo, monospace`
    const w = g.measureText(o.overlay).width
    const pad = 8 * scale
    const dark = document.documentElement.dataset.theme === 'dark'
    g.fillStyle = dark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)'
    g.fillRect(img.width - w - pad * 3, img.height - 28 * scale - pad * 2, w + pad * 2, 20 * scale + pad)
    g.fillStyle = dark ? '#ededed' : '#171717'
    g.textBaseline = 'middle'
    g.fillText(o.overlay, img.width - w - pad * 2, img.height - 18 * scale - pad * 1.5)
    const blob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('Could not encode the image'))), 'image/png'))
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    if (useStore.getState().theme !== theme) useStore.setState({ theme })
    if (useStore.getState().page !== page) useStore.getState().go(page)
  }
}

/** Re-renders when an instrument publishes a capture. */
export function useLatest(i: Instrument): Table | null {
  return useSyncExternalStore(
    (cb) => onPublish((x) => x === i && cb()),
    () => latestOf(i)
  )
}
