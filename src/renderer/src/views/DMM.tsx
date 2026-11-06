// Digital Multimeter (board: DMM). Only on Analog Discovery Pro 5250; other devices see the layout
// with a banner.
import { Banner, Button, Description, Material, StatusDot } from '@robcholz/geist'
import { Hand, Info, Minus, Play, Square } from 'lucide-react'
import { useRef, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { LabeledSelect, PageBar, ScrollPage } from '../components/Page'
import { si } from '../components/format'
import { jitter, useInterval } from '../components/useInterval'
import { devices } from '../devices'
import { useStore } from '../store'

const FUNCTIONS = ['DC Voltage', 'AC Voltage', 'DC Current', 'AC Current', 'Resistance', 'Continuity', 'Diode', 'Temperature']
const RANGES = ['Auto', '100 mV', '1 V', '10 V', '100 V']
const RES = ['5½ Digits', '4½ Digits']
const INPUTS = ['10 MΩ', '> 10 GΩ']

const truth: Record<string, { v: number; unit: string; noise: number }> = {
  'DC Voltage': { v: 3.29871, unit: 'V', noise: 0.00004 },
  'AC Voltage': { v: 1.41402, unit: 'V', noise: 0.0002 },
  'DC Current': { v: 0.0124, unit: 'A', noise: 0.000002 },
  'AC Current': { v: 0.00351, unit: 'A', noise: 0.000003 },
  Resistance: { v: 4698.3, unit: 'Ω', noise: 0.2 },
  Continuity: { v: 0.82, unit: 'Ω', noise: 0.02 },
  Diode: { v: 0.6214, unit: 'V', noise: 0.0002 },
  Temperature: { v: 23.42, unit: '°C', noise: 0.01 }
}

interface DMMState {
  running: boolean
  fn: string
  range: string
  res: string
  input: string
  set: (p: Partial<Omit<DMMState, 'set'>>) => void
}
const useDMM = create<DMMState>()(
  persist((set) => ({ running: true, fn: 'DC Voltage', range: 'Auto', res: '5½ Digits', input: '10 MΩ', set: (p) => set(p) }), { name: 'oscillo.dmm', partialize: ({ set: _s, ...r }) => r })
)

interface Stats {
  last: number
  min: number
  max: number
  sum: number
  n: number
}
const empty: Stats = { last: NaN, min: Infinity, max: -Infinity, sum: 0, n: 0 }

export function DMM() {
  const d = useDMM()
  const app = useStore()
  const [hold, setHold] = useState(false)
  const [rel, setRel] = useState<number | null>(null)
  const [st, setSt] = useState<Stats>(empty)
  const live = d.running && app.running && !!app.device && !hold
  const t = truth[d.fn]
  const digits = d.res === '5½ Digits' ? 6 : 5
  const stRef = useRef(st)
  stRef.current = st

  useInterval(() => {
    const v = t.v + jitter(t.noise) - (rel ?? 0)
    const s = stRef.current
    setSt({ last: v, min: Math.min(s.min, v), max: Math.max(s.max, v), sum: s.sum + v, n: s.n + 1 })
  }, d.res === '5½ Digits' ? 400 : 200, live)

  const change = (p: Partial<DMMState>) => {
    d.set(p)
    setSt(empty)
    if (p.fn) setRel(null)
  }
  const run = () => {
    if (!app.device) return app.toast('No device connected', { detail: 'Connect a device, then press Run.' })
    if (!app.running) app.setRunning(true)
    d.set({ running: !d.running })
  }
  const toggleRel = () => {
    if (rel !== null) {
      setRel(null)
      setSt(empty)
      return
    }
    if (!Number.isFinite(st.last)) return
    setRel(st.last)
    setSt(empty)
    app.toast('Relative on', { detail: `Readings are offset by ${si(st.last, t.unit, digits - 1)}.` })
  }

  const fmt = (v: number) => (Number.isFinite(v) ? si(v, t.unit, digits) : '—')
  const dev = app.device ? devices[app.device] : null

  return (
    <ScrollPage
      className="flex flex-col gap-4"
      bar={
        <PageBar title="Digital Multimeter" status={<StatusDot state={live ? 'READY' : hold ? 'BUILDING' : 'QUEUED'} label={live ? 'Running' : hold ? 'Held' : 'Stopped'} />} sub="Available on Analog Discovery Pro 5250">
          <Button size="small" type={hold ? 'secondary' : 'tertiary'} prefix={<Hand size={16} />} aria-pressed={hold} onClick={() => setHold(!hold)} tooltip="Freeze the reading">
            Hold
          </Button>
          <Button size="small" type={rel !== null ? 'secondary' : 'tertiary'} prefix={<Minus size={16} />} aria-pressed={rel !== null} onClick={toggleRel} tooltip="Subtract the current reading">
            Relative
          </Button>
          <Button size="small" prefix={d.running && app.running ? <Square size={16} /> : <Play size={16} />} onClick={run} tooltipKeys={['Space']}>
            {d.running && app.running ? 'Stop' : 'Run'}
          </Button>
        </PageBar>
      }
    >
      {dev && !dev.name.includes('5250') && (
        <Banner icon={<Info size={16} />} className="-mx-4 -mt-4 mb-0">
          {dev.name} has no DMM. This view shows the Analog Discovery Pro 5250 layout.
        </Banner>
      )}
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-4 max-[1100px]:grid-cols-1">
        <Material className="flex min-w-0 flex-col gap-6 p-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-gray-900">
              {d.fn}
              {rel !== null && ' · Relative'}
            </span>
            <span className="text-[13px] text-gray-900">Range {d.range}</span>
          </div>
          <span className="text-[72px] font-semibold leading-[80px] tabular-nums tracking-[-4.32px]">{fmt(st.last)}</span>
          <div className="grid grid-cols-4 gap-4 max-[1180px]:grid-cols-2">
            <Description title="Min" content={<span className="tabular-nums">{st.n ? fmt(st.min) : '—'}</span>} />
            <Description title="Max" content={<span className="tabular-nums">{st.n ? fmt(st.max) : '—'}</span>} />
            <Description title="Average" content={<span className="tabular-nums">{st.n ? fmt(st.sum / st.n) : '—'}</span>} />
            <Description title="Samples" content={<span className="tabular-nums">{st.n.toLocaleString()}</span>} />
          </div>
        </Material>
        <Material className="flex min-w-0 flex-col gap-3 p-6">
          <LabeledSelect label="Function" value={d.fn} options={FUNCTIONS} onValueChange={(fn) => change({ fn })} />
          <LabeledSelect label="Range" value={d.range} options={RANGES} onValueChange={(range) => change({ range })} disabled={!['DC Voltage', 'AC Voltage'].includes(d.fn)} />
          <LabeledSelect label="Resolution" value={d.res} options={RES} onValueChange={(res) => change({ res })} />
          <LabeledSelect label="Input Impedance" value={d.input} options={INPUTS} onValueChange={(input) => change({ input })} disabled={d.fn !== 'DC Voltage'} />
          <Button size="small" type="secondary" onClick={() => setSt(empty)}>
            Reset Statistics
          </Button>
        </Material>
      </div>
    </ScrollPage>
  )
}
