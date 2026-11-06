// Export and Logging preferences, shared by the Export page and the Log buttons on instrument pages.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CsvOpts, Instrument } from '../files'
import type { LogWhen } from '../logging'

const D = {
  format: 'CSV' as 'CSV' | 'TXT',
  dataInstrument: 'Oscilloscope' as Instrument,
  source: 'All Columns',
  time: 'Seconds' as NonNullable<CsvOpts['time']>,
  decimal: 'Locale' as 'Locale' | 'Point',
  header: true,
  comments: true,
  notes: false,
  imgTheme: 'Current' as 'Current' | 'Light' | 'Dark',
  overlay: true,
  instrument: 'Oscilloscope' as Instrument,
  save: 'Every Capture' as LogWhen,
  pattern: '{instrument}_{index:4}_{date:yyyy-MM-dd_HHmmss}.csv',
  folder: '~/Documents/Oscillo/Logs',
  withData: true
}
export type E = typeof D
export const useExport = create<E & { set: (p: Partial<E>) => void }>()(
  persist((set) => ({ ...D, set: (p) => set(p) }), {
    name: 'oscillo.export',
    version: 2,
    // Earlier versions offered NI TDMS, SVG and TypeScript Logic, which were never written.
    migrate: (s) => ({ ...D, ...(s as Partial<E>), format: (s as E).format === 'TXT' ? 'TXT' : 'CSV', save: ['Every Capture', 'Every Triggered Capture', 'Manual'].includes((s as E).save) ? (s as E).save : 'Every Capture', source: 'All Columns' }),
    partialize: ({ set: _s, ...r }) => r
  })
)

