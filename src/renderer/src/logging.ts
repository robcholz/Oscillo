// Automatic logging: writes a file for each new capture of one instrument while on. Runs from any
// page, since the instruments publish their captures to files.ts whether Export is open or not.
import { create } from 'zustand'
import { files, latestOf, onPublish, toCsv, type CsvOpts, type Instrument, type Table } from './files'
import { useStore } from './store'
import { useExport } from './views/export-store'

export type LogWhen = 'Every Capture' | 'Every Triggered Capture' | 'Manual'

export interface LogOpts {
  instrument: Instrument
  when: LogWhen
  pattern: string
  folder: string
  csv: CsvOpts
}

interface LogState {
  on: boolean
  instrument: Instrument | null
  count: number
  last: string | null
  error: string | null
}
export const useLogging = create<LogState>()(() => ({ on: false, instrument: null, count: 0, last: null, error: null }))

/** Expands {index:N}, {date:format} and {instrument} in a file name pattern. */
export function expand(p: string, index: number, inst: string, at = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return p
    .replace(/\{index(?::(\d+))?\}/g, (_, n) => pad(index, Number(n ?? 1)))
    .replace(/\{date:([^}]+)\}/g, (_, f: string) =>
      f.replace('yyyy', String(at.getFullYear())).replace('MM', pad(at.getMonth() + 1)).replace('dd', pad(at.getDate())).replace('HH', pad(at.getHours())).replace('mm', pad(at.getMinutes())).replace('ss', pad(at.getSeconds()))
    )
    .replace(/\{instrument\}/g, inst.toLowerCase().replace(/\s+/g, '-'))
}

let stop: (() => void) | null = null
let opts: LogOpts | null = null
let busy = false

async function write(t: Table): Promise<void> {
  if (!files || !opts || busy) return
  busy = true
  const n = useLogging.getState().count + 1
  try {
    const name = expand(opts.pattern, n, opts.instrument, new Date(t.at))
    const path = await files.write(`${opts.folder.replace(/\/$/, '')}/${name}`, toCsv(t, opts.csv))
    useLogging.setState({ count: n, last: path, error: null })
  } catch (e) {
    const msg = ((e as Error)?.message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    useLogging.setState({ error: msg })
    stopLogging()
    useStore.getState().toast('Logging stopped', { detail: msg })
  } finally {
    busy = false
  }
}

export function startLogging(o: LogOpts): void {
  stopLogging()
  opts = o
  useLogging.setState({ on: true, instrument: o.instrument, count: 0, last: null, error: null })
  if (o.when === 'Manual') return
  stop = onPublish((i, t) => {
    if (i !== o.instrument) return
    if (o.when === 'Every Triggered Capture' && t.triggered === false) return
    void write(t)
  })
}

/** Manual mode, or Save Now while logging: writes the latest capture. */
export async function logNow(): Promise<void> {
  if (!opts) return
  const t = latestOf(opts.instrument)
  if (!t) return useStore.getState().toast('Nothing to log yet', { detail: `Run the ${opts.instrument} to capture data first.` })
  await write(t)
}

export function stopLogging(): void {
  stop?.()
  stop = null
  useLogging.setState({ on: false })
}

/** The Log buttons on instrument pages: start or stop logging that instrument with the Export page's settings. */
export function toggleLoggingFor(instrument: Instrument): void {
  const toast = useStore.getState().toast
  const l = useLogging.getState()
  if (l.on && l.instrument === instrument) {
    stopLogging()
    return toast('Logging stopped', { detail: `${l.count} ${l.count === 1 ? 'file' : 'files'} written.` })
  }
  const e = useExport.getState()
  startLogging({ instrument, when: e.save, pattern: e.pattern, folder: e.folder, csv: { format: e.format, time: e.time, decimal: e.decimal, header: e.header } })
  toast(`Logging ${instrument}`, { detail: e.save === 'Manual' ? 'Press Save Now on the Export page to write each file.' : `Files go to ${e.folder}. Change this on the Export page.` })
}

/** True while this instrument is being logged. */
export const useLoggingOf = (i: Instrument): boolean => useLogging((l) => l.on && l.instrument === i)
