// Oscilloscope settings, remembered with the workspace.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ScopeCfg } from '../sim/scope'

export type ChannelId = 'C1' | 'C2' | 'M1' | 'R1'

export interface Measurement {
  id: number
  ch: ChannelId
  m: string
}

interface ScopeState {
  cfg: ScopeCfg
  running: boolean
  runMode: string
  samples: number
  rate: number
  rangeDisplay: string
  updateMs: number
  history: number
  show: Record<ChannelId | 'digital', boolean>
  names: Record<'C1' | 'C2', string>
  labels: Record<'C1' | 'C2', string>
  probe: Record<'C1' | 'C2', string>
  sampleMode: Record<'C1' | 'C2', string>
  noiseBand: Record<'C1' | 'C2', string>
  hysteresis: string
  holdoff: string
  lengthCond: string
  length: string
  filter: string
  autoTimeout: string
  triggerType: string
  zoom: number
  cursors: number[]
  notes: string
  plotLabels: { text: string; x: number }[]
  measurements: Measurement[]
  audio: { on: boolean; src: string; vol: number }
  set: (p: Partial<Omit<ScopeState, 'set' | 'setCfg' | 'setCh'>>) => void
  setCfg: (p: Partial<ScopeCfg>) => void
  setCh: (ch: 'C1' | 'C2', p: Partial<ScopeCfg['ch']['C1']>) => void
}

export const useScope = create<ScopeState>()(
  persist(
    (set, get) => ({
      cfg: {
        base: 200e-6,
        position: 0,
        triggerSource: 'Channel 1',
        triggerMode: 'Auto',
        condition: 'Rising',
        level: 0,
        ch: {
          C1: { on: true, offset: 0, range: 1, probe: 1, coupling: 'DC' },
          C2: { on: true, offset: -3, range: 1, probe: 1, coupling: 'DC' }
        },
        math: 'C1 - C2 / 2'
      },
      running: true,
      runMode: 'Repeated',
      samples: 8192,
      rate: 4.096e6,
      rangeDisplay: 'Per Division',
      updateMs: 100,
      history: 32,
      show: { C1: true, C2: true, M1: false, R1: false, digital: false },
      names: { C1: 'Channel 1', C2: 'Channel 2' },
      labels: { C1: '', C2: '' },
      probe: { C1: '1x', C2: '1x' },
      sampleMode: { C1: 'Average', C2: 'Average' },
      noiseBand: { C1: 'Off', C2: 'Off' },
      hysteresis: 'Auto',
      holdoff: '0',
      lengthCond: 'Less',
      length: '10',
      filter: 'Decimate',
      autoTimeout: '100',
      triggerType: 'Edge',
      zoom: 1,
      cursors: [-400e-6, 600e-6],
      notes: '',
      plotLabels: [],
      measurements: [
        { id: 1, ch: 'C1', m: 'Frequency' },
        { id: 2, ch: 'C1', m: 'Peak to Peak' },
        { id: 3, ch: 'C1', m: 'AC RMS' },
        { id: 4, ch: 'C2', m: 'Positive Duty' },
        { id: 5, ch: 'C2', m: 'Rise Time' },
        { id: 6, ch: 'M1', m: 'Average' }
      ],
      audio: { on: false, src: 'Channel 1', vol: 60 },
      set: (p) => set(p),
      setCfg: (p) => set({ cfg: { ...get().cfg, ...p } }),
      setCh: (ch, p) => set({ cfg: { ...get().cfg, ch: { ...get().cfg.ch, [ch]: { ...get().cfg.ch[ch], ...p } } } })
    }),
    { name: 'oscillo.scope', version: 1 }
  )
)
