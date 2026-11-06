// Spectrum Analyzer (board: Spectrum). Live FFT of C1 with sample, peak-hold and averaged traces,
// draggable cursors, harmonic components, and measurements computed from the bins.
import { Button, DotsMenu, FormModal, LegendItem, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger, StatusDot, Switch, Table, Tabs, Textarea, type FormField } from '@robcholz/geist'
import { ChevronDown, Copy, Crosshair, Download, Maximize2, Pencil, Play, Plus, ScrollText, Square, StepForward, Trash2, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Cursor } from '../components/Cursor'
import { fixed, si } from '../components/format'
import { Grid2, LabeledSelect, PageBar, PanelSection, SplitPage } from '../components/Page'
import { Plot, type Series } from '../components/Plot'
import { UnitInput } from '../components/UnitInput'
import { useInterval } from '../components/useInterval'
import { analyze, metrics, testSignal, toDbv, WINDOWS, type WindowName } from '../sim/spectrum'
import { useStore } from '../store'

const FS = 10000
const N = 16384
const TABS = ['Spectrum', 'Time', 'Components', 'Notes'] as const
const TYPES = ['Sample', 'Peak Hold', 'Min Hold', 'Linear RMS Average', 'Exp RMS Average', 'Linear dB Average', 'Exp dB Average']
const UNITS = ['dBV', 'dBu', 'dB', 'Vrms', 'Vpeak'] as const
const COLORS = ['var(--wf-c1)', 'var(--wf-c3)', 'var(--wf-c2)', 'var(--wf-c4)', 'var(--wf-c5)']

interface Trace {
  id: string
  name: string
  channel: string
  type: string
  shown: boolean
}

interface SpecState {
  running: boolean
  algorithm: 'FFT' | 'CZT'
  start: number
  stop: number
  mode: string
  scale: string
  window: WindowName
  beta: number
  avg: number
  units: (typeof UNITS)[number]
  top: number
  range: number
  ref: number
  c1Offset: number
  c1Range: number
  probe: string
  sampleMode: string
  traces: Trace[]
  notes: string
  set: (p: Partial<Omit<SpecState, 'set'>>) => void
}

const useSpectrum = create<SpecState>()(
  persist(
    (set) => ({
      running: true,
      algorithm: 'FFT',
      start: 0,
      stop: 5000,
      mode: 'Start / Stop',
      scale: 'Linear',
      window: 'Flat Top',
      beta: 8,
      avg: 10,
      units: 'dBV',
      top: 10,
      range: 120,
      ref: 1,
      c1Offset: 0,
      c1Range: 5,
      probe: '1x',
      sampleMode: 'Average',
      traces: [
        { id: 't1', name: 'Trace 1', channel: 'Channel 1', type: 'Sample', shown: true },
        { id: 't2', name: 'Trace 2', channel: 'Channel 1', type: 'Peak Hold', shown: true }
      ],
      notes: '',
      set: (p) => set(p)
    }),
    { name: 'oscillo.spectrum', partialize: ({ set: _s, ...r }) => r }
  )
)

/** Convert V RMS to the chosen units. */
function unit(v: number, u: SpecState['units'], ref: number): number {
  if (u === 'dBV') return toDbv(v)
  if (u === 'dBu') return toDbv(v / 0.7746)
  if (u === 'dB') return toDbv(v / ref)
  if (u === 'Vrms') return v
  return v * Math.SQRT2
}
const isLog = (u: string) => u.startsWith('dB')

export function Spectrum() {
  const s = useSpectrum()
  const app = useStore()
  const toast = app.toast
  const [tab, setTab] = useState<(typeof TABS)[number]>('Spectrum')
  const [frame, setFrame] = useState(0)
  const [cursors, setCursors] = useState<number[]>([1000, 2000])
  const [labels, setLabels] = useState<{ f: number; text: string }[]>([])
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void }>(null)
  const hold = useRef<{ max?: Float64Array; min?: Float64Array; avg?: Float64Array; n: number; ref?: Float64Array }>({ n: 0 })
  const live = s.running && app.running && !!app.device

  useInterval(() => setFrame((x) => x + 1), 300, live)

  const time = useMemo(() => testSignal(N, FS, (frame * 0.37) % 1), [frame])
  const spec = useMemo(() => analyze(time, FS, s.window, s.beta), [time, s.window, s.beta])
  const m = useMemo(() => metrics(spec), [spec])

  // Hold and average traces accumulate across frames.
  useMemo(() => {
    const h = hold.current
    const v = spec.vrms
    if (!h.max || h.max.length !== v.length) {
      h.max = v.slice()
      h.min = v.slice()
      h.avg = v.slice()
      h.n = 1
      return
    }
    h.n = Math.min(h.n + 1, s.avg)
    const a = 1 / h.n
    for (let k = 0; k < v.length; k++) {
      h.max[k] = Math.max(h.max[k], v[k])
      h.min![k] = Math.min(h.min![k], v[k])
      h.avg![k] = Math.sqrt((1 - a) * h.avg![k] ** 2 + a * v[k] ** 2)
    }
  }, [spec, s.avg])

  const traceData = (t: Trace): Float64Array => {
    const h = hold.current
    if (t.channel === 'Hold' && h.ref) return h.ref
    if (t.type === 'Peak Hold') return h.max ?? spec.vrms
    if (t.type === 'Min Hold') return h.min ?? spec.vrms
    if (t.type.includes('Average')) return h.avg ?? spec.vrms
    return spec.vrms
  }

  const yLog = isLog(s.units)
  const yAxis = yLog ? { min: s.top - s.range, max: s.top, unit: s.units, divisions: s.range % 20 === 0 && s.range <= 200 ? s.range / 20 : s.range % 10 === 0 && s.range <= 100 ? s.range / 10 : 5 } : { min: 0, max: s.c1Range / 2, unit: s.units === 'Vrms' ? 'V' : 'V', divisions: 5 }
  const xAxis = { min: Math.max(s.scale === 'Logarithmic' ? 10 : 0, s.start), max: s.stop, unit: 'Hz', label: 'f', log: s.scale === 'Logarithmic' }
  const series: Series[] = s.traces.map((t, i) => {
    const d = traceData(t)
    const lo = Math.max(1, Math.floor(xAxis.min / spec.binHz))
    const hi = Math.min(d.length - 1, Math.ceil(xAxis.max / spec.binHz))
    return {
      id: t.id,
      name: `${t.name} · ${t.type}`,
      color: COLORS[i % COLORS.length],
      unit: s.units,
      hidden: !t.shown,
      x: spec.f.subarray(lo, hi + 1),
      y: Float64Array.from(d.subarray(lo, hi + 1), (v) => unit(v, s.units, s.ref))
    }
  })

  const at = (f: number, d = spec.vrms) => unit(d[Math.round(f / spec.binHz)] ?? 0, s.units, s.ref)
  const fmtY = (v: number) => (yLog ? `${fixed(v, '', 2)} ${s.units}` : si(v, 'V'))
  const zoomed = s.start > 0 || s.stop < FS / 2

  const zoom = (k: number) => {
    const c = (s.start + s.stop) / 2
    const w = Math.max(20, Math.min(FS / 2, (s.stop - s.start) * k))
    const a = Math.max(0, Math.min(FS / 2 - w, c - w / 2))
    s.set({ start: Math.round(a), stop: Math.round(a + w) })
  }
  const run = () => {
    if (!app.device) return toast('No device connected', { detail: 'Connect a device, then press Run.' })
    if (!app.running) app.setRunning(true)
    s.set({ running: !s.running })
  }
  const addTrace = (type: string, channel = 'Channel 1') => {
    if (s.traces.length >= 5) return toast('Five traces is the limit', { detail: 'Remove a trace to add another.' })
    const id = 't' + Date.now()
    s.set({ traces: [...s.traces, { id, name: `Trace ${s.traces.length + 1}`, channel, type, shown: true }] })
  }

  const bar = (
    <PageBar title="Spectrum Analyzer" status={<StatusDot state={live ? 'READY' : 'QUEUED'} label={live ? 'Running' : 'Stopped'} />}>
      <Switch aria-label="Algorithm" value={s.algorithm} options={['FFT', 'CZT'] as const} onChange={(algorithm) => s.set({ algorithm })} />
      <Button size="small" type="secondary" prefix={<StepForward size={16} />} onClick={() => { if (!app.device) return toast('No device connected', { detail: 'Connect a device, then press Single.' }); s.set({ running: false }); setFrame(frame + 1) }}>
        Single
      </Button>
      <Button size="small" prefix={live ? <Square size={16} /> : <Play size={16} />} onClick={run} tooltipKeys={['Space']}>
        {live ? 'Stop' : 'Run'}
      </Button>
    </PageBar>
  )

  const overlay = (toPct: (x: number, y: number) => { left: string; top: string }) => (
    <>
      {cursors.map((f, i) =>
        f >= xAxis.min && f <= xAxis.max ? (
          <Cursor
            key={i}
            label={'X' + (i + 1)}
            left={toPct(f, 0).left}
            onMove={(fx) => {
              const v = xAxis.log ? 10 ** (Math.log10(xAxis.min) + fx * (Math.log10(xAxis.max) - Math.log10(xAxis.min))) : xAxis.min + fx * (xAxis.max - xAxis.min)
              setCursors(cursors.map((c, k) => (k === i ? Math.round(v / spec.binHz) * spec.binHz : c)))
            }}
          />
        ) : null
      )}
      {labels.map((l, i) => (
        <span key={i} className="absolute z-[2] h-[22px] rounded-small bg-background-100 px-2 text-xs leading-[22px] shadow-[0_0_0_1px_var(--gray-alpha-600)]" style={{ left: toPct(l.f, 0).left, bottom: 16 + (i % 3) * 28 }}>
          {l.text}
        </span>
      ))}
      {!zoomed && (
        <div className="pointer-events-none absolute z-[2] ml-2 flex flex-col rounded-small bg-background-100 px-2 py-1 text-xs tabular-nums shadow-tooltip" style={{ left: toPct(m.fundamental.f, 0).left, top: `calc(${toPct(0, unit(10 ** (m.fundamental.dbv / 20), s.units, s.ref)).top} + 24px)` }}>
          <span>Peak {si(m.fundamental.f, 'Hz', 4)}</span>
          <span className="text-gray-900">{fmtY(unit(10 ** (m.fundamental.dbv / 20), s.units, s.ref))}</span>
        </div>
      )}
    </>
  )

  const cursorRows = cursors.map((f, i) => ({
    c: 'X' + (i + 1),
    x: si(f, 'Hz', 4),
    d: i ? si(f - cursors[0], 'Hz', 4) : '',
    f: i && f !== cursors[0] ? si(1 / Math.abs(f - cursors[0]), 's', 4) : '',
    v1: fmtY(at(f)),
    v2: s.traces[1] ? fmtY(at(f, traceData(s.traces[1]))) : ''
  }))
  const db = (v: number, u: string) => `${fixed(v, '', 1)} ${u}`

  let body
  if (tab === 'Spectrum')
    body = <Plot x={xAxis} y={yAxis} series={series} ariaLabel="Spectrum" overlay={overlay} probe="nearest" />
  else if (tab === 'Time') {
    const n = Math.round(0.005 * FS)
    body = (
      <>
        <div className="flex flex-wrap gap-2">
          <LegendItem color="var(--wf-c1)" label="C1 · 1 kHz sine, 707 mV RMS" />
        </div>
        <Plot x={{ min: 0, max: 0.005, unit: 's', label: 't' }} y={{ min: -1, max: 1, unit: 'V' }} series={[{ id: 'c1', name: 'C1', color: 'var(--wf-c1)', unit: 'V', x: Float64Array.from({ length: n }, (_, i) => i / FS), y: time.subarray(0, n) }]} ariaLabel="C1 time domain" />
      </>
    )
  } else if (tab === 'Components') {
    const comps = [{ n: 'Fundamental', f: m.fundamental.f, v: m.fundamental.dbv }, ...m.harmonics.map((h) => ({ n: ['2nd', '3rd', '4th', '5th'][h.n - 2], f: h.f, v: h.dbv }))]
    body = <Plot x={{ min: 0, max: comps.length + 1, unit: '', divisions: comps.length + 1, format: (v) => (v === 0 ? 'DC' : comps[Math.round(v) - 1]?.n ?? '') }} y={{ min: -110, max: 10, unit: 'dBV', divisions: 4 }} series={[{ id: 'h', name: 'Magnitude', color: 'var(--wf-c1)', unit: 'dBV', kind: 'bars', x: Float64Array.from([0, ...comps.map((_, i) => i + 1)]), y: Float64Array.from([toDbv(Math.abs(spec.vrms[0])), ...comps.map((c) => c.v)]) }]} ariaLabel="Harmonic components" probe="nearest" />
  } else body = <Textarea aria-label="Notes" rows={14} placeholder="Notes for this measurement, saved with the workspace" value={s.notes} onChange={(e) => s.set({ notes: e.target.value })} />

  const panel = (
    <>
      <PanelSection title="Frequency">
        <Grid2>
          <LabeledSelect label="Mode" value={s.mode} options={['Start / Stop', 'Center / Span']} onValueChange={(mode) => s.set({ mode })} />
          <LabeledSelect label="Scale" value={s.scale} options={['Linear', 'Logarithmic']} onValueChange={(scale) => s.set({ scale })} />
          {s.mode === 'Start / Stop' ? (
            <>
              <UnitInput label="Start" value={s.start} suffix="Hz" min={0} max={s.stop - 10} onCommit={(start) => s.set({ start })} />
              <UnitInput label="Stop" value={s.stop} scale={1000} suffix="kHz" min={s.start + 10} max={FS / 2} onCommit={(stop) => s.set({ stop })} />
            </>
          ) : (
            <>
              <UnitInput label="Center" value={(s.start + s.stop) / 2} scale={1000} suffix="kHz" min={0} max={FS / 2} onCommit={(c) => { const w = s.stop - s.start; s.set({ start: Math.max(0, c - w / 2), stop: Math.min(FS / 2, c + w / 2) }) }} />
              <UnitInput label="Span" value={s.stop - s.start} scale={1000} suffix="kHz" min={10} max={FS / 2} onCommit={(w) => { const c = (s.start + s.stop) / 2; s.set({ start: Math.max(0, c - w / 2), stop: Math.min(FS / 2, c + w / 2) }) }} />
            </>
          )}
          <UnitInput label="BINs" value={N / 2 + 1} integer disabled onCommit={() => {}} />
          <UnitInput label="Samples" value={N} integer disabled onCommit={() => {}} />
          <LabeledSelect label="Resolution" value="Auto" options={['Auto', 'Manual']} onValueChange={() => toast('Resolution follows the span', { detail: 'Manual resolution needs CZT. Switch the algorithm to CZT first.' })} />
          <UnitInput label="RBW" value={spec.binHz * spec.enbw} suffix="Hz" decimals={2} disabled onCommit={() => {}} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Magnitude">
        <Grid2>
          <LabeledSelect label="Units" value={s.units} options={UNITS} onValueChange={(v) => s.set({ units: v as SpecState['units'] })} />
          <UnitInput label="Top" value={s.top} suffix={s.units} disabled={!yLog} onCommit={(top) => s.set({ top })} />
          <UnitInput label="Range" value={s.range} suffix="dB" min={10} max={200} disabled={!yLog} onCommit={(range) => s.set({ range })} />
          <UnitInput label="Reference" value={s.ref} suffix="V" min={1e-6} disabled={s.units !== 'dB'} onCommit={(ref) => s.set({ ref })} />
        </Grid2>
      </PanelSection>
      {s.traces.map((t, i) => (
        <PanelSection
          key={t.id}
          title={
            <>
              <span className="h-0.5 w-3" style={{ background: COLORS[i % COLORS.length] }} aria-hidden />
              {t.name}
            </>
          }
          actions={
            <DotsMenu
              aria-label={`${t.name} Actions`}
              menu={
                <>
                  <MenuItem prefix={<Copy size={16} />} onSelect={() => { hold.current.ref = traceData(t).slice(); addTrace('Sample', 'Hold'); toast(`${t.name} held as reference`) }}>Hold as Reference</MenuItem>
                  <MenuItem prefix={<Download size={16} />} onSelect={() => toast(`Exported ${t.name.toLowerCase().replace(' ', '-')}.csv`, { detail: `${spec.f.length.toLocaleString()} bins.` })}>Export Trace</MenuItem>
                  <MenuSeparator />
                  <MenuItem danger prefix={<Trash2 size={16} />} disabled={s.traces.length === 1} onSelect={() => s.set({ traces: s.traces.filter((x) => x.id !== t.id) })}>Remove</MenuItem>
                </>
              }
            />
          }
        >
          <Grid2>
            <LabeledSelect label="Channel" value={t.channel} options={['Channel 1', 'Channel 2', 'Math 1', 'Hold']} onValueChange={(channel) => s.set({ traces: s.traces.map((x) => (x.id === t.id ? { ...x, channel } : x)) })} />
            <LabeledSelect label="Type" value={t.type} options={TYPES} onValueChange={(type) => { hold.current = { n: 0, ref: hold.current.ref }; s.set({ traces: s.traces.map((x) => (x.id === t.id ? { ...x, type } : x)) }) }} />
            {i === 0 && (
              <>
                <LabeledSelect label="Window" value={s.window} options={WINDOWS} onValueChange={(v) => { hold.current = { n: 0, ref: hold.current.ref }; s.set({ window: v as WindowName }) }} />
                <UnitInput label="Average Count" value={s.avg} integer min={1} max={1000} onCommit={(avg) => s.set({ avg })} />
                <UnitInput label="Kaiser Beta" value={s.beta} min={0} max={30} disabled={s.window !== 'Kaiser'} onCommit={(beta) => s.set({ beta })} />
              </>
            )}
          </Grid2>
        </PanelSection>
      ))}
      <PanelSection title="Scope Channels">
        <Grid2>
          <UnitInput label="C1 Offset" value={s.c1Offset} suffix="V" onCommit={(c1Offset) => s.set({ c1Offset })} />
          <UnitInput label="C1 Range" value={s.c1Range} suffix="V" min={0.01} max={50} onCommit={(c1Range) => s.set({ c1Range })} />
          <LabeledSelect label="C1 Probe" value={s.probe} options={['1x', '10x']} onValueChange={(probe) => s.set({ probe })} />
          <LabeledSelect label="Sample Mode" value={s.sampleMode} options={['Average', 'Decimate']} onValueChange={(sampleMode) => s.set({ sampleMode })} />
        </Grid2>
      </PanelSection>
    </>
  )

  return (
    <SplitPage bar={bar} panelId="spectrum" panel={panel}>
      <Tabs tabs={TABS.map((t) => ({ title: t, value: t }))} selected={tab} setSelected={(v) => setTab(v as (typeof TABS)[number])} />
      {tab === 'Spectrum' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {s.traces.map((t, i) => (
              <LegendItem key={t.id} size="medium" color={COLORS[i % COLORS.length]} label={`${t.name} · ${t.channel === 'Channel 1' ? 'C1' : t.channel === 'Channel 2' ? 'C2' : t.channel} ${t.type}`} detail={s.units} pressed={t.shown} onToggle={(shown) => s.set({ traces: s.traces.map((x) => (x.id === t.id ? { ...x, shown } : x)) })} />
            ))}
            <div className="flex">
              <Button type="secondary" size="small" prefix={<Plus size={16} />} className="rounded-r-none" onClick={() => addTrace('Sample', 'Channel 2')}>
                Add Trace
              </Button>
              <MenuRoot>
                <MenuTrigger asChild>
                  <Button type="secondary" size="small" svgOnly aria-label="More Trace Types" tooltip className="ml-px rounded-l-none">
                    <ChevronDown size={16} />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  {TYPES.map((t) => (
                    <MenuItem key={t} onSelect={() => addTrace(t)}>
                      C1 {t}
                    </MenuItem>
                  ))}
                </MenuContent>
              </MenuRoot>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button type="tertiary" size="small" svgOnly aria-label="Zoom In" tooltip disabled={s.stop - s.start <= 20} onClick={() => zoom(0.5)}>
              <ZoomIn size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label="Zoom Out" tooltip disabled={!zoomed} onClick={() => zoom(2)}>
              <ZoomOut size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label="Show Entire Span" tooltip disabled={!zoomed} onClick={() => s.set({ start: 0, stop: FS / 2 })}>
              <Maximize2 size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label={cursors.length >= 4 ? 'Remove Extra Cursors' : 'Add Cursor'} tooltip onClick={() => setCursors(cursors.length >= 4 ? cursors.slice(0, 2) : [...cursors, (s.start + s.stop) / 2])}>
              <Crosshair size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label="Add Label" tooltip onClick={() => setDialog({ title: 'Add Label', submitLabel: 'Add Label', fields: [{ key: 't', label: 'Label Text', placeholder: 'Mains hum', required: true }], onSubmit: (v) => setLabels([...labels, { f: cursors[0], text: v.t }]) })}>
              <Pencil size={16} />
            </Button>
            <DotsMenu
              aria-label="Plot Actions"
              menu={
                <>
                  <MenuItem prefix={<Download size={16} />} onSelect={() => toast('Exported spectrum.csv', { detail: `${spec.f.length.toLocaleString()} bins, ${s.traces.length} traces.` })}>Export Data</MenuItem>
                  <MenuItem prefix={<Upload size={16} />} onSelect={() => toast('Exported spectrum.png')}>Export Image</MenuItem>
                  <MenuItem prefix={<ScrollText size={16} />} onSelect={() => app.go('logger')}>Start Logging</MenuItem>
                  <MenuSeparator />
                  <MenuItem prefix={<ZoomIn size={16} />} onSelect={() => s.set({ start: Math.max(0, cursors[0] - 250), stop: cursors[0] + 250 })}>Zoom to X1</MenuItem>
                </>
              }
            />
          </div>
        </div>
      )}
      {body}
      <Table
        compact
        caption="Cursors"
        columns={[
          { key: 'c', title: 'Cursor' },
          { key: 'x', title: 'Position', align: 'right' },
          { key: 'd', title: 'Delta', align: 'right' },
          { key: 'f', title: '1 / Delta', align: 'right' },
          { key: 'v1', title: s.traces[0]?.name ?? 'Trace 1', align: 'right' },
          { key: 'v2', title: s.traces[1]?.name ?? '', align: 'right' }
        ]}
        rows={cursorRows}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
        <Table
          compact
          caption="Dynamic measurements"
          columns={[{ key: 'm', title: 'Dynamic' }, { key: 'v', title: 'Value', align: 'right' }]}
          rows={[
            { m: 'Noise Floor', v: db(m.noiseFloor, 'dBV') },
            { m: 'SNR', v: db(m.snr, 'dB') },
            { m: 'THD', v: db(m.thd, 'dBc') },
            { m: 'SINAD', v: db(m.sinad, 'dB') },
            { m: 'ENOB', v: fixed(m.enob, 'bits', 2) },
            { m: 'SFDR', v: db(m.sfdr, 'dBc') }
          ]}
        />
        <Table
          compact
          caption="Constant measurements"
          columns={[{ key: 'm', title: 'Constant' }, { key: 'v', title: 'Value', align: 'right' }]}
          rows={[
            { m: 'ENBW', v: fixed(spec.enbw, 'bins', 2) },
            { m: 'Resolution', v: si(spec.binHz, 'Hz') },
            { m: 'RBW', v: si(spec.binHz * spec.enbw, 'Hz') },
            { m: 'Full Scale', v: `${s.c1Range} V` },
            { m: 'Dynamic Range', v: db(-m.noiseFloor + toDbv(s.c1Range / 2 / Math.SQRT2) - 10 * Math.log10(spec.enbw), 'dB') },
            { m: 'Samples', v: N.toLocaleString() }
          ]}
        />
        <Table
          compact
          caption="Harmonics"
          columns={[{ key: 'h', title: 'Harmonic' }, { key: 'f', title: 'Frequency', align: 'right' }, { key: 'v', title: 'Magnitude', align: 'right' }]}
          rows={[{ h: 'Fundamental', f: si(m.fundamental.f, 'Hz', 4), v: db(m.fundamental.dbv, 'dBV') }, ...m.harmonics.slice(0, 3).map((h) => ({ h: ['2nd', '3rd', '4th'][h.n - 2], f: si(h.f, 'Hz', 4), v: db(h.dbv, 'dBV') }))]}
        />
      </div>
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </SplitPage>
  )
}
