// Data Logger (board: Logger). Logs functions of the scope channels over minutes or hours, with a
// channel table, history plot and acquisition settings.
import { Button, Checkbox, DotsMenu, FormModal, LegendItem, MenuItem, MenuSeparator, Select, SplitButton, type FormField } from '@robcholz/geist'
import { Download, FileCode, Pencil, Play, Plus, Square, Trash2, Eraser } from 'lucide-react'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fixed } from '../components/format'
import { Grid2, LabeledInput, LabeledSelect, PageBar, PanelSection, SplitPage } from '../components/Page'
import { Plot, type Series } from '../components/Plot'
import { UnitInput } from '../components/UnitInput'
import { useInterval } from '../components/useInterval'
import { publish, saveTable, type Table as DataTable } from '../files'
import { useStore } from '../store'
import { wantMeters } from '../hwsync'
import { readChannel } from './meters'

const HISTORY = ['1 Minute', '10 Minutes', '1 Hour', 'Unlimited'] as const
const FUNCS = ['DC', 'AC RMS', 'True RMS', 'Formula']
const COLORS = ['var(--wf-c1)', 'var(--wf-c2)', 'var(--wf-c3)', 'var(--wf-c4)', 'var(--wf-c5)']
const minutes: Record<string, number> = { '1 Minute': 1, '10 Minutes': 10, '1 Hour': 60, Unlimited: 60 }

interface LogCh {
  id: string
  name: string
  src: 'C1' | 'C2'
  fn: string
  formula: string
  color: number
  offset: number
  range: number
  shown: boolean
}

interface LoggerState {
  running: boolean
  history: string
  rate: number
  window: string
  windowLen: number
  source: string
  scale: string
  timeAxis: string
  channels: LogCh[]
  set: (p: Partial<Omit<LoggerState, 'set'>>) => void
}

const useLogger = create<LoggerState>()(
  persist(
    (set) => ({
      running: true,
      history: '10 Minutes',
      rate: 10,
      window: 'Auto',
      windowLen: 0.01,
      source: 'Scope',
      scale: 'Shared',
      timeAxis: 'Relative',
      channels: [
        { id: 'L1', name: 'C1 DC', src: 'C1', fn: 'DC', formula: '', color: 0, offset: 0, range: 0.5, shown: true },
        { id: 'L2', name: 'C2 True RMS', src: 'C2', fn: 'True RMS', formula: '', color: 1, offset: 0, range: 0.5, shown: true }
      ],
      set: (p) => set(p)
    }),
    { name: 'oscillo.logger', partialize: ({ set: _s, ...r }) => r }
  )
)

/** Logged points per channel: [seconds ago is derived from t] */
interface Point {
  t: number
  v: Record<string, number>
}

function sample(c: LogCh): number {
  const r = readChannel(c.src === 'C1' ? 0 : 1)
  const base = c.fn === 'DC' ? r.dc : c.fn === 'AC RMS' ? r.ac : r.rms
  return base + c.offset
}

let memory: Point[] | null = null

export function Logger() {
  const s = useLogger()
  const app = useStore()
  const [pts, setPts] = useState<Point[]>(() => (memory ??= []))
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void }>(null)
  const live = s.running && app.running && !!app.device
  const logTable = (): DataTable => {
    const t0 = pts[0]?.t ?? Date.now()
    return { columns: ['Time (s)', ...s.channels.map((c) => c.name)], data: [pts.map((p) => (p.t - t0) / 1000), ...s.channels.map((c) => pts.map((p) => p.v[c.id] ?? NaN))], at: t0 }
  }
  useEffect(() => {
    memory = pts
    if (pts.length) publish('Logger', logTable())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts])
  useEffect(() => wantMeters(live), [live])

  useInterval(() => {
    const now = Date.now()
    const keep = s.history === 'Unlimited' ? Infinity : minutes[s.history] * 60_000
    setPts((p) => [...p.filter((x) => now - x.t <= keep), { t: now, v: Object.fromEntries(s.channels.map((c) => [c.id, sample(c)])) }])
  }, Math.max(100, 1000 / Math.min(10, s.rate)), live)

  const setCh = (id: string, p: Partial<LogCh>) => s.set({ channels: s.channels.map((c) => (c.id === id ? { ...c, ...p } : c)) })
  const win = minutes[s.history]
  const now = pts.length ? pts[pts.length - 1].t : Date.now()

  const series: Series[] = s.channels.map((c) => {
    const xs = pts.filter((p) => c.id in p.v)
    return {
      id: c.id,
      name: c.name,
      color: COLORS[c.color % COLORS.length],
      unit: 'V',
      hidden: !c.shown,
      x: Float64Array.from(xs, (p) => (p.t - now) / 60_000),
      y: Float64Array.from(xs, (p) => p.v[c.id])
    }
  })

  // Shared scale: 10 divisions of the first shown channel's Range/div, centred on the logged data.
  const lead = s.channels.find((c) => c.shown) ?? s.channels[0]
  const div = lead?.range ?? 0.4
  let lo = Infinity
  let hi = -Infinity
  for (const sr of series) if (!sr.hidden) for (let k = 0; k < sr.y.length; k++) (lo = Math.min(lo, sr.y[k])), (hi = Math.max(hi, sr.y[k]))
  const mid = Number.isFinite(lo) ? Math.round((lo + hi) / 2 / div) * div : 0
  const yAxis = { min: mid - 5 * div, max: mid + 5 * div, unit: 'V' }

  const stats = (id: string) => {
    let min = Infinity
    let max = -Infinity
    for (const p of pts) if (id in p.v) (min = Math.min(min, p.v[id])), (max = Math.max(max, p.v[id]))
    const last = pts.length ? pts[pts.length - 1].v[id] : NaN
    return { min, max, last }
  }

  const add = (src: 'C1' | 'C2', fn: string) => {
    const id = 'L' + (Math.max(0, ...s.channels.map((c) => Number(c.id.slice(1)))) + 1)
    const color = s.channels.length % COLORS.length
    s.set({ channels: [...s.channels, { id, name: `${src} ${fn}`, src, fn, formula: '', color, offset: 0, range: 0.5, shown: true }] })
    app.toast(`Added ${src} ${fn}`)
  }

  const editFn = (c: LogCh) =>
    setDialog({
      title: `Edit ${c.name}`,
      submitLabel: 'Save',
      fields: [
        { key: 'name', label: 'Name', value: c.name, required: true },
        { key: 'src', label: 'Source', type: 'select', value: c.src, options: ['C1', 'C2'] },
        { key: 'fn', label: 'Function', type: 'select', value: c.fn, options: FUNCS },
        { key: 'formula', label: 'Formula', value: c.formula, mono: true, placeholder: 'C1 * 2 - 0.5', help: 'Used when Function is Formula.' }
      ],
      onSubmit: (v) => setCh(c.id, { name: v.name, src: v.src as 'C1' | 'C2', fn: v.fn, formula: v.formula })
    })

  const bar = (
    <PageBar title="Data Logger" sub={`${s.channels.length} channels · ${s.rate} Hz`}>
      <div className="w-[140px]">
        <Select size="small" aria-label="History" value={s.history} options={HISTORY} onValueChange={(history) => s.set({ history })} />
      </div>
      <Button size="small" type="tertiary" prefix={<Eraser size={16} />} onClick={() => { setPts([]); app.toast('Log cleared') }}>
        Clear
      </Button>
      <Button size="small" type="secondary" prefix={<Download size={16} />} onClick={() => void saveTable('logger.csv', logTable(), { time: 'Clock Time' })}>
        Export
      </Button>
      <Button size="small" prefix={live ? <Square size={16} /> : <Play size={16} />} onClick={() => { if (!app.running) app.setRunning(true); s.set({ running: !s.running }) }} tooltipKeys={['Space']}>
        {live ? 'Stop' : 'Run'}
      </Button>
    </PageBar>
  )

  const panel = (
    <>
      <PanelSection title="Display">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] leading-4 text-gray-900">Channels Shown</span>
          {s.channels.map((c) => (
            <Checkbox key={c.id} checked={c.shown} onChange={(shown) => setCh(c.id, { shown })}>
              {c.name}
            </Checkbox>
          ))}
        </div>
        <Grid2>
          <LabeledSelect label="Scale" value={s.scale} options={['Shared', 'Per Channel']} onValueChange={(scale) => s.set({ scale })} />
          <LabeledSelect label="Time Axis" value={s.timeAxis} options={['Relative', 'Clock Time']} onValueChange={(timeAxis) => s.set({ timeAxis })} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Acquisition">
        <Grid2>
          <UnitInput label="Rate" value={s.rate} suffix="Hz" min={0.01} max={1000} onCommit={(rate) => s.set({ rate })} />
          <LabeledSelect label="Window" value={s.window} options={['Auto', 'Manual']} onValueChange={(window) => s.set({ window })} />
          <UnitInput label="Window Length" value={s.windowLen} scale={1e-3} suffix="ms" min={0.0001} disabled={s.window === 'Auto'} onCommit={(windowLen) => s.set({ windowLen })} />
          <LabeledSelect label="Source" value={s.source} options={['Scope', 'Voltmeter']} onValueChange={(source) => s.set({ source })} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Export Range">
        <div className="flex flex-col gap-3">
          <LabeledInput label="From" type="datetime-local" defaultValue={new Date(now - win * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} />
          <LabeledInput label="To" type="datetime-local" defaultValue={new Date(now - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} />
        </div>
      </PanelSection>
    </>
  )

  const fmtX = (v: number) => (s.timeAxis === 'Clock Time' ? new Date(now + v * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `${fixed(v, '', win >= 10 ? 0 : 1)} min`)

  return (
    <SplitPage bar={bar} panelId="logger" panel={panel}>
      <div className="flex flex-wrap items-center gap-2">
        {s.channels.map((c) => (
          <LegendItem key={c.id} size="medium" color={COLORS[c.color % COLORS.length]} label={c.name} detail={`${c.range} V/div`} pressed={c.shown} onToggle={(shown) => setCh(c.id, { shown })} />
        ))}
      </div>
      <Plot x={{ min: -win, max: 0, unit: 'min', label: 't', format: fmtX }} y={yAxis} series={series} ariaLabel="Logged history" />
      <section className="flex flex-col">
        <div className="flex min-h-10 items-center justify-between gap-2">
          <h2 className="m-0 text-sm font-semibold leading-5 tracking-[-0.28px]">Channels</h2>
          <SplitButton
            prefix={<Plus size={16} />}
            onClick={() => add('C1', 'DC')}
            menuLabel="More channel types"
            menu={
              <>
                {(['C1', 'C2'] as const).flatMap((src) => ['DC', 'AC RMS', 'True RMS'].map((fn) => <MenuItem key={src + fn} onSelect={() => add(src, fn)}>{`${src} ${fn}`}</MenuItem>))}
              </>
            }
          >
            Add Channel
          </SplitButton>
        </div>
        <div className="grid grid-cols-[minmax(140px,1.4fr)_120px_repeat(3,minmax(72px,0.7fr))_96px_96px_32px] items-center gap-x-3 border-b border-gray-alpha-400 px-2 py-2 text-[13px] text-gray-900">
          <span>Name</span>
          <span>Function</span>
          <span className="text-right">Value</span>
          <span className="text-right">Min</span>
          <span className="text-right">Max</span>
          <span>Offset</span>
          <span>Range/div</span>
          <span />
        </div>
        {s.channels.map((c) => {
          const st = stats(c.id)
          return (
            <div key={c.id} className="grid grid-cols-[minmax(140px,1.4fr)_120px_repeat(3,minmax(72px,0.7fr))_96px_96px_32px] items-center gap-x-3 border-b border-gray-alpha-400 px-2 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-6 w-1 flex-none rounded-full" style={{ background: COLORS[c.color % COLORS.length] }} aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="text-xs text-gray-900">{c.src === 'C1' ? 'Scope Channel 1' : 'Scope Channel 2'}</span>
                </span>
              </span>
              <Select size="small" aria-label={`${c.name} function`} value={c.fn} options={FUNCS} onValueChange={(fn) => (fn === 'Formula' ? editFn({ ...c, fn }) : setCh(c.id, { fn }))} />
              <span className="text-right tabular-nums">{fixed(st.last, 'V', 3)}</span>
              <span className="text-right tabular-nums text-gray-900">{Number.isFinite(st.min) ? fixed(st.min, 'V', 3) : '—'}</span>
              <span className="text-right tabular-nums text-gray-900">{Number.isFinite(st.max) ? fixed(st.max, 'V', 3) : '—'}</span>
              <UnitInput label={`${c.name} offset`} hideLabel value={c.offset} suffix="V" onCommit={(offset) => setCh(c.id, { offset })} />
              <UnitInput label={`${c.name} range per division`} hideLabel value={c.range} suffix="V" min={0.001} onCommit={(range) => setCh(c.id, { range })} />
              <DotsMenu
                aria-label={`${c.name} actions`}
                menu={
                  <>
                    <MenuItem prefix={<FileCode size={16} />} onSelect={() => editFn(c)}>Edit Function</MenuItem>
                    <MenuItem prefix={<Pencil size={16} />} onSelect={() => setCh(c.id, { color: c.color + 1 })}>Change Color</MenuItem>
                    <MenuSeparator />
                    <MenuItem danger prefix={<Trash2 size={16} />} onSelect={() => { s.set({ channels: s.channels.filter((x) => x.id !== c.id) }); app.toast(`Removed ${c.name}`) }}>
                      Remove
                    </MenuItem>
                  </>
                }
              />
            </div>
          )
        })}
        {s.channels.length === 0 && <div className="px-2 py-4 text-sm text-gray-900">No channels. Use Add Channel to log a signal.</div>}
      </section>
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </SplitPage>
  )
}
