// Digital Multimeter (board: DMM). Only on Analog Discovery Pro 5250; other devices see the layout
// with a banner.
import { Banner, Button, Description, Material, StatusDot } from '@robcholz/geist'
import { Pause, Info, Minus, Play, Square } from 'lucide-react'
import { useRef, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { LabeledSelect, PageBar, ScrollPage } from '../components/Page'
import { si } from '../components/format'
import { useInterval } from '../components/useInterval'
import { hw, useDevice } from '../devices'
import { useStore } from '../store'

const FUNCTIONS = ['DC Voltage', 'AC Voltage', 'DC Current', 'AC Current', 'Resistance', 'Continuity', 'Diode', 'Temperature']
const RANGES = ['Auto', '100 mV', '1 V', '10 V', '100 V']
const RES = ['5½ Digits', '4½ Digits']
const INPUTS = ['10 MΩ', '> 10 GΩ']

/** DwfDmm modes from dwf.h. */
const MODE: Record<string, number> = { Resistance: 1, Continuity: 2, Diode: 3, 'DC Voltage': 4, 'AC Voltage': 5, 'DC Current': 6, 'AC Current': 7, Temperature: 10 }
/** A range like "10 V" in base units; 0 is auto. */
const rangeOf = (r: string, _unit: string): number => {
  if (r === 'Auto') return 0
  const m = /([\d.]+)\s*(m)?/.exec(r)
  return m ? Number(m[1]) * (m[2] ? 1e-3 : 1) : 0
}

/** The unit each function reads in. */
const UNIT: Record<string, string> = {
  'DC Voltage': 'V',
  'AC Voltage': 'V',
  'DC Current': 'A',
  'AC Current': 'A',
  Resistance: 'Ω',
  Continuity: 'Ω',
  Diode: 'V',
  Temperature: '°C'
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
  const unit = UNIT[d.fn]
  const digits = d.res === '5½ Digits' ? 6 : 5
  const stRef = useRef(st)
  stRef.current = st

  const dev = useDevice()
  const hasDmm = !!dev?.name.includes('5250')
  const busy = useRef(false)
  const add = (raw: number) => {
    const v = raw - (rel ?? 0)
    const s = stRef.current
    setSt({ last: v, min: Math.min(s.min, v), max: Math.max(s.max, v), sum: s.sum + v, n: s.n + 1 })
  }
  useInterval(
    () => {
      if (busy.current || !hw) return
      busy.current = true
      hw.dmm(MODE[d.fn], rangeOf(d.range, unit))
        .then(add)
        .catch((e: Error) => {
          d.set({ running: false })
          app.toast('DMM stopped', { detail: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
        })
        .finally(() => (busy.current = false))
    },
    d.res === '5½ Digits' ? 400 : 200,
    live && hasDmm
  )

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
    app.toast('Relative on', { detail: `Readings are offset by ${si(st.last, unit, digits - 1)}.` })
  }

  const fmt = (v: number) => (Number.isFinite(v) ? si(v, unit, digits) : '—')

  return (
    <ScrollPage
      className="flex flex-col gap-4"
      bar={
        <PageBar title="Digital Multimeter" status={<StatusDot state={live ? 'READY' : hold ? 'BUILDING' : 'QUEUED'} label={live ? 'Running' : hold ? 'Held' : 'Stopped'} />} sub="Available on Analog Discovery Pro 5250">
          <Button size="small" type="secondary" prefix={hold ? <Play size={16} /> : <Pause size={16} />} aria-pressed={hold} onClick={() => setHold(!hold)} tooltip={hold ? 'Resume live readings' : 'Freeze the reading'}>
            {hold ? 'Resume' : 'Hold'}
          </Button>
          <Button size="small" type="secondary" prefix={<Minus size={16} />} aria-pressed={rel !== null} onClick={toggleRel} tooltip="Subtract the current reading">
            Relative
          </Button>
          <Button size="small" prefix={d.running && app.running ? <Square size={16} /> : <Play size={16} />} onClick={run} tooltipKeys={['Space']}>
            {d.running && app.running ? 'Stop' : 'Run'}
          </Button>
        </PageBar>
      }
    >
      {dev && !hasDmm && (
        <Banner icon={<Info size={16} />} className="-mx-4 -mt-4 mb-0">
          {dev.name} has no DMM. Connect an Analog Discovery Pro 5250 to use it.
        </Banner>
      )}
      <Material className="flex min-w-0 flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-gray-900">
            {d.fn} · {d.range === 'Auto' ? 'Auto Range' : `Range ${d.range}`}
            {rel !== null && ' · Relative'}
          </span>
          <Button size="small" type="tertiary" disabled={!st.n} onClick={() => setSt(empty)}>
            Reset Statistics
          </Button>
        </div>
        <span className="text-[72px] font-semibold leading-[80px] tabular-nums tracking-[-4.32px]">{fmt(st.last)}</span>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Description title="Min" content={<span className="tabular-nums">{st.n ? fmt(st.min) : '—'}</span>} />
          <Description title="Max" content={<span className="tabular-nums">{st.n ? fmt(st.max) : '—'}</span>} />
          <Description title="Average" content={<span className="tabular-nums">{st.n ? fmt(st.sum / st.n) : '—'}</span>} />
          <Description title="Samples" content={<span className="tabular-nums">{st.n.toLocaleString()}</span>} />
        </div>
      </Material>
      <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2">
        <LabeledSelect label="Function" value={d.fn} options={FUNCTIONS} onValueChange={(fn) => change({ fn })} />
        <LabeledSelect label="Range" value={d.range} options={RANGES} onValueChange={(range) => change({ range })} disabled={!['DC Voltage', 'AC Voltage'].includes(d.fn)} />
        <LabeledSelect label="Resolution" value={d.res} options={RES} onValueChange={(res) => change({ res })} />
        <LabeledSelect label="Input" value={d.input} options={INPUTS} onValueChange={(input) => change({ input })} disabled={d.fn !== 'DC Voltage'} />
      </div>
    </ScrollPage>
  )
}
