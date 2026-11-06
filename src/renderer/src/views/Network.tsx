// Network Analyzer (board: Network). Sweeps Wavegen across frequency and plots the measured
// channel against the reference as Bode, Nyquist and Nichols plots, with a sweep table.
import { Button, DotsMenu, FormModal, LegendItem, MenuItem, MenuSeparator, Progress, StatusDot, Table, Tabs, type FormField } from '@robcholz/geist'
import { Copy, Crosshair, Download, Maximize2, Pencil, Play, ScrollText, Square, StepForward, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Cursor } from '../components/Cursor'
import { fixed, si } from '../components/format'
import { Grid2, LabeledSelect, PageBar, PanelSection, SplitPage } from '../components/Page'
import { Plot, type Series } from '../components/Plot'
import { UnitInput } from '../components/UnitInput'
import { useInterval } from '../components/useInterval'
import { lowPass, mag, phaseDeg, sweep } from '../sim/network'
import { useHardware } from '../devices'
import { cdiv, respond, useSweep } from '../hwsync'
import { publish, saveImage, saveTable, type Table as DataTable } from '../files'
import { toggleLoggingFor, useLoggingOf } from '../logging'
import { useStore } from '../store'

const TABS = ['Bode', 'Nyquist', 'Nichols', 'Time', 'Data'] as const

interface NetState {
  running: boolean
  scale: string
  steps: number
  start: number
  stop: number
  settle: number
  periods: number
  source: string
  amp: number
  offset: number
  ampTable: string
  reference: string
  gain: number
  c2Offset: number
  probe: string
  sampleMode: string
  units: string
  top: number
  range: number
  phaseOffset: number
  phaseRange: number
  show: { mag: boolean; ph: boolean; ref: boolean }
  set: (p: Partial<Omit<NetState, 'set'>>) => void
}

const useNetwork = create<NetState>()(
  persist(
    (set) => ({
      running: true,
      scale: 'Logarithmic',
      steps: 100,
      start: 10,
      stop: 100e3,
      settle: 0,
      periods: 8,
      source: 'Wavegen 1',
      amp: 1,
      offset: 0,
      ampTable: 'Off',
      reference: 'Channel 1',
      gain: 1,
      c2Offset: 0,
      probe: '1x',
      sampleMode: 'Average',
      units: 'dB',
      top: 10,
      range: 100,
      phaseOffset: 0,
      phaseRange: 180,
      show: { mag: true, ph: true, ref: false },
      set: (p) => set(p)
    }),
    { name: 'oscillo.network', partialize: ({ set: _s, ...r }) => r }
  )
)

export function Network() {
  const s = useNetwork()
  const app = useStore()
  const logging = useLoggingOf('Network')
  const toast = app.toast
  const [tab, setTab] = useState<(typeof TABS)[number]>('Bode')
  const [done, setDone] = useState(s.steps)
  const [view, setView] = useState<[number, number] | null>(null)
  const [cursors, setCursors] = useState<number[]>([])
  const [labels, setLabels] = useState<{ f: number; text: string }[]>([])
  const [refData, setRefData] = useState<Float64Array | null>(null)
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void }>(null)
  const live = s.running && app.running && !!app.device
  const log = s.scale === 'Logarithmic'

  const real = useHardware()
  const [single, setSingle] = useState(false)
  // One sweep step per tick; a finished sweep restarts while running.
  useInterval(() => setDone((d) => (d >= s.steps ? 1 : d + 1)), Math.max(15, 2400 / s.steps), live && !real)

  const freqs = useMemo(() => sweep(s.start, s.stop, s.steps, log), [s.start, s.stop, s.steps, log])
  // A real device: the generator drives the circuit; the response is C2 over C1 (or C1 over C2).
  const gen = s.source === 'Wavegen 2' ? 1 : 0
  const hwSweep = useSweep(
    real && (live || single),
    freqs,
    async (f) => {
      const [c1, c2] = await respond(f, { amp: s.amp, offset: s.offset, periods: s.periods, settle: s.settle, gen })
      return s.reference === 'Channel 2' ? cdiv(c1, c2) : cdiv(c2, c1)
    },
    { gen, once: single && !live, onDone: () => setSingle(false) }
  )
  const simH = useMemo(() => freqs.map((f) => lowPass(f)), [freqs])
  const H = real ? hwSweep.pts : simH
  const n = real ? hwSweep.done : Math.min(done, s.steps)
  const at = (f: number) => (real ? (H[freqs.reduce((b, x, i) => (Math.abs(x - f) < Math.abs(freqs[b] - f) ? i : b), 0)] ?? { re: 0, im: 0 }) : lowPass(f))
  const fx = Float64Array.from(freqs.slice(0, n))
  const toMag = (h: (typeof H)[number]) => (s.units === 'dB' ? 20 * Math.log10(mag(h) * s.gain) : mag(h) * s.gain)
  const magY = Float64Array.from(H.slice(0, n), toMag)
  const phY = Float64Array.from(H.slice(0, n), (h) => phaseDeg(h) + s.phaseOffset)
  const [x0, x1] = view ?? [s.start, s.stop]
  const xAxis = { min: x0, max: x1, unit: 'Hz', label: 'f', log }
  const netTable = (): DataTable => ({ columns: ['Frequency (Hz)', `Magnitude (${s.units})`, 'Phase (°)'], data: [fx, magY, phY], at: Date.now() })
  useEffect(() => {
    if (n === s.steps) publish('Network', netTable())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n === s.steps, H])
  const cur = freqs[n - 1]
  const hCur = H[n - 1]

  const magSeries: Series[] = [
    { id: 'm', name: 'C2 Magnitude', color: 'var(--wf-c2)', unit: s.units, hidden: !s.show.mag, x: fx, y: magY },
    ...(refData ? [{ id: 'r', name: 'Ref 1', color: 'var(--gray-700)', unit: s.units, dashed: true, hidden: !s.show.ref, x: Float64Array.from(freqs), y: refData }] : [])
  ]

  const run = () => {
    if (!app.device) return toast('No device connected', { detail: 'Connect a device, then press Run.' })
    if (!app.running) app.setRunning(true)
    s.set({ running: !s.running })
  }
  const zoom = (k: number) => {
    const c = log ? Math.sqrt(x0 * x1) : (x0 + x1) / 2
    const r = log ? Math.min(s.stop / s.start, (x1 / x0) ** k) : Math.min(s.stop - s.start, (x1 - x0) * k)
    let a = log ? c / Math.sqrt(r) : c - r / 2
    a = Math.max(s.start, a)
    let b = log ? a * r : a + r
    if (b > s.stop) (b = s.stop), (a = log ? b / r : b - r)
    setView(a <= s.start && b >= s.stop ? null : [a, b])
  }
  const fromFx = (f: number) => (log ? 10 ** (Math.log10(x0) + f * (Math.log10(x1) - Math.log10(x0))) : x0 + f * (x1 - x0))

  const overlay = (toPct: (x: number, y: number) => { left: string; top: string }) => (
    <>
      {live && n < s.steps && <span className="pointer-events-none absolute inset-y-0 border-l border-gray-alpha-600" style={{ left: toPct(cur, 0).left }} />}
      {cursors.map((f, i) => (
        <Cursor key={i} label={'X' + (i + 1)} left={toPct(f, 0).left} onMove={(p) => setCursors(cursors.map((c, k) => (k === i ? fromFx(p) : c)))} />
      ))}
      {labels.map((l, i) => (
        <span key={i} className="absolute z-[2] h-[22px] rounded-small bg-background-100 px-2 text-xs leading-[22px] shadow-[0_0_0_1px_var(--gray-alpha-600)]" style={{ left: toPct(l.f, 0).left, bottom: 16 + (i % 3) * 28 }}>
          {l.text}
        </span>
      ))}
      {!view && hCur && (
        <div className="pointer-events-none absolute right-3 top-3 z-[2] flex gap-3 rounded-small bg-background-100 px-2 py-1 text-xs tabular-nums shadow-tooltip">
          <span>{si(cur, 'Hz')}</span>
          <span className="text-[var(--wf-c2)]">{s.units === 'dB' ? fixed(toMag(hCur), 'dB', 2) : fixed(toMag(hCur), '×', 3)}</span>
          <span className="text-[var(--wf-c3)]">{fixed(phaseDeg(hCur), '°', 1)}</span>
        </div>
      )}
    </>
  )

  let body
  if (tab === 'Bode')
    body = (
      <>
        <Plot x={xAxis} y={s.units === 'dB' ? { min: s.top - s.range, max: s.top, unit: 'dB', divisions: 5 } : { min: 0, max: 1.5, unit: '×', divisions: 5 }} series={magSeries} ariaLabel="Magnitude" overlay={overlay} onView={(a, b) => { a = Math.max(s.start, a); b = Math.min(s.stop, b); if (b > a * 1.01) setView(a <= s.start && b >= s.stop ? null : [a, b]) }} height="calc(240px + max(0px, (100vh - 900px) * 0.5))" />
        <Plot
          x={xAxis}
          y={{ min: s.phaseOffset - s.phaseRange, max: s.phaseOffset + (s.phaseRange > 180 ? s.phaseRange - 180 : 0), unit: '°', divisions: 4 }}
          series={[{ id: 'p', name: 'C2 Phase', color: 'var(--wf-c3)', unit: '°', hidden: !s.show.ph, x: fx, y: phY }]}
          ariaLabel="Phase"
          height="calc(150px + max(0px, (100vh - 900px) * 0.3))"
          overlay={(toPct) => (
            <>
              {cursors.map((f, i) => (
                <span key={i} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-gray-1000" style={{ left: toPct(f, 0).left }} />
              ))}
            </>
          )}
        />
      </>
    )
  else if (tab === 'Nyquist')
    body = (
      <>
        <div className="flex flex-wrap gap-2">
          <LegendItem color="var(--wf-c2)" label="C2 / C1 · Nyquist" />
        </div>
        <Plot x={{ min: -0.8, max: 1.7, unit: '', label: 'Re', divisions: 5 }} y={{ min: -1.3, max: 0.2, unit: '', divisions: 5 }} series={[{ id: 'n', name: 'Im', color: 'var(--wf-c2)', x: Float64Array.from(H.slice(0, n), (h) => h.re * s.gain), y: Float64Array.from(H.slice(0, n), (h) => h.im * s.gain) }]} probe="nearest" ariaLabel="Nyquist plot" />
      </>
    )
  else if (tab === 'Nichols')
    body = (
      <>
        <div className="flex flex-wrap gap-2">
          <LegendItem color="var(--wf-c2)" label="C2 / C1 · Nichols" />
        </div>
        <Plot x={{ min: -180, max: 0, unit: '°', label: 'Phase', divisions: 4 }} y={{ min: -90, max: 10, unit: 'dB', divisions: 5 }} series={[{ id: 'g', name: 'Gain', color: 'var(--wf-c2)', unit: 'dB', x: phY, y: Float64Array.from(H.slice(0, n), (h) => 20 * Math.log10(mag(h) * s.gain)) }]} probe="nearest" ariaLabel="Nichols plot" />
      </>
    )
  else if (tab === 'Time') {
    const f = cur ?? 1000
    const t = Float64Array.from({ length: 600 }, (_, i) => (i / 600) * (3 / f))
    body = (
      <>
        <div className="flex flex-wrap gap-2">
          <LegendItem color="var(--wf-c1)" label="C1 Stimulus" />
          <LegendItem color="var(--wf-c2)" label="C2 Response" />
        </div>
        <Plot
          x={{ min: 0, max: 3 / f, unit: 's', label: 't' }}
          y={{ min: -1.5 * s.amp, max: 1.5 * s.amp, unit: 'V' }}
          series={[
            { id: 'c1', name: 'C1', color: 'var(--wf-c1)', unit: 'V', x: t, y: Float64Array.from(t, (x) => s.offset + s.amp * Math.sin(2 * Math.PI * f * x)) },
            { id: 'c2', name: 'C2', color: 'var(--wf-c2)', unit: 'V', x: t, y: Float64Array.from(t, (x) => s.offset + s.amp * mag(hCur) * s.gain * Math.sin(2 * Math.PI * f * x + (phaseDeg(hCur) * Math.PI) / 180)) }
          ]}
          ariaLabel="Stimulus and response at the current sweep frequency"
        />
      </>
    )
  } else
    body = (
      <Table
        compact
        caption="Sweep data"
        columns={[
          { key: 'i', title: 'Step', align: 'right' },
          { key: 'f', title: 'Frequency', align: 'right' },
          { key: 'm', title: 'Magnitude', align: 'right', mono: true },
          { key: 'p', title: 'Phase', align: 'right', mono: true }
        ]}
        rows={freqs.slice(0, n).map((f, i) => ({ i: i + 1, f: si(f, 'Hz'), m: s.units === 'dB' ? fixed(magY[i], 'dB', 2) : fixed(magY[i], '×', 3), p: fixed(phY[i], '°', 1) }))}
      />
    )

  const panel = (
    <>
      <PanelSection title="Sweep">
        <Grid2>
          <LabeledSelect label="Scale" value={s.scale} options={['Logarithmic', 'Linear']} onValueChange={(scale) => { setView(null); s.set({ scale }) }} />
          <UnitInput label="Steps" value={s.steps} integer min={2} max={10000} onCommit={(steps) => { setDone(1); setRefData(null); s.set({ steps }) }} />
          <UnitInput label="Start" value={s.start} suffix="Hz" min={1} max={s.stop / 2} onCommit={(start) => { setView(null); setDone(1); setRefData(null); s.set({ start }) }} />
          <UnitInput label="Stop" value={s.stop} scale={1000} suffix="kHz" min={s.start * 2} max={50e6} onCommit={(stop) => { setView(null); setDone(1); setRefData(null); s.set({ stop }) }} />
          <UnitInput label="Settle" value={s.settle} suffix="s" min={0} onCommit={(settle) => s.set({ settle })} />
          <UnitInput label="Min Periods" value={s.periods} integer min={1} onCommit={(periods) => s.set({ periods })} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Stimulus">
        <Grid2>
          <LabeledSelect label="Source" value={s.source} options={['Wavegen 1', 'Wavegen 2', 'External Sweep']} onValueChange={(source) => s.set({ source })} />
          <UnitInput label="Amplitude" value={s.amp} suffix="V" min={0.001} max={5} onCommit={(amp) => s.set({ amp })} />
          <UnitInput label="Offset" value={s.offset} suffix="V" min={-5} max={5} onCommit={(offset) => s.set({ offset })} />
          <LabeledSelect label="Amplitude Table" value={s.ampTable} options={['Off', 'On']} onValueChange={(ampTable) => s.set({ ampTable })} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Channels">
        <Grid2>
          <LabeledSelect label="Reference" value={s.reference} options={['Channel 1', 'None']} onValueChange={(reference) => s.set({ reference })} />
          <LabeledSelect label="Measure" value="Channel 2" options={['Channel 2']} onValueChange={() => {}} />
          <UnitInput label="C2 Gain" value={s.gain} suffix="x" min={0.001} onCommit={(gain) => s.set({ gain })} />
          <UnitInput label="C2 Offset" value={s.c2Offset} suffix="V" onCommit={(c2Offset) => s.set({ c2Offset })} />
          <LabeledSelect label="C2 Probe" value={s.probe} options={['1x', '10x']} onValueChange={(probe) => s.set({ probe })} />
          <LabeledSelect label="Sample Mode" value={s.sampleMode} options={['Average', 'Decimate']} onValueChange={(sampleMode) => s.set({ sampleMode })} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Display">
        <Grid2>
          <LabeledSelect label="Magnitude" value={s.units} options={['dB', 'Gain']} onValueChange={(units) => { setRefData(null); s.set({ units }) }} />
          <UnitInput label="Top" value={s.top} suffix="dB" disabled={s.units !== 'dB'} onCommit={(top) => s.set({ top })} />
          <UnitInput label="Range" value={s.range} suffix="dB" min={10} max={200} disabled={s.units !== 'dB'} onCommit={(range) => s.set({ range })} />
          <UnitInput label="Phase Offset" value={s.phaseOffset} suffix="°" min={-360} max={360} onCommit={(phaseOffset) => s.set({ phaseOffset })} />
          <UnitInput label="Phase Range" value={s.phaseRange} suffix="°" min={45} max={360} onCommit={(phaseRange) => s.set({ phaseRange })} />
        </Grid2>
      </PanelSection>
    </>
  )

  return (
    <SplitPage
      bar={
        <PageBar title="Network Analyzer" status={<StatusDot state={live ? (n < s.steps ? 'BUILDING' : 'READY') : 'QUEUED'} label={live ? (n < s.steps ? 'Sweeping' : 'Sweep Done') : 'Stopped'} />}>
          <Button size="small" type="secondary" prefix={<StepForward size={16} />} onClick={() => { if (!app.device) return toast('No device connected', { detail: 'Connect a device, then press Single.' }); s.set({ running: false }); if (real) { setSingle(true); return toast('Single sweep started', { detail: `${s.steps} steps, ${si(s.start, 'Hz')} to ${si(s.stop, 'Hz')}.` }) } setDone(s.steps); toast('Single sweep done', { detail: `${s.steps} steps, ${si(s.start, 'Hz')} to ${si(s.stop, 'Hz')}.` }) }}>
            Single
          </Button>
          <Button size="small" prefix={live ? <Square size={16} /> : <Play size={16} />} onClick={run} tooltipKeys={['Space']}>
            {live ? 'Stop' : 'Run'}
          </Button>
        </PageBar>
      }
      panelId="network"
      panel={panel}
    >
      <Tabs tabs={TABS.map((t) => ({ title: t, value: t }))} selected={tab} setSelected={(v) => setTab(v as (typeof TABS)[number])} />
      {tab === 'Bode' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <LegendItem size="medium" color="var(--wf-c2)" label="C2 Magnitude" detail={s.units} pressed={s.show.mag} onToggle={(mag) => s.set({ show: { ...s.show, mag } })} />
            <LegendItem size="medium" color="var(--wf-c3)" label="C2 Phase" detail="°" pressed={s.show.ph} onToggle={(ph) => s.set({ show: { ...s.show, ph } })} />
            {refData && <LegendItem size="medium" color="var(--gray-700)" dashed label="Ref 1" detail={s.units} pressed={s.show.ref} onToggle={(ref) => s.set({ show: { ...s.show, ref } })} />}
            <Button type="tertiary" size="small" prefix={<Copy size={16} />} disabled={n < s.steps} onClick={() => { setRefData(Float64Array.from(H, toMag)); s.set({ show: { ...s.show, ref: true } }); toast('Reference held', { detail: 'Ref 1 keeps this sweep for comparison.' }) }}>
              Hold Reference
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button type="tertiary" size="small" svgOnly aria-label="Zoom In" tooltip onClick={() => zoom(0.5)}>
              <ZoomIn size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label="Zoom Out" tooltip disabled={!view} onClick={() => zoom(2)}>
              <ZoomOut size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label="Show Entire Sweep" tooltip disabled={!view} onClick={() => setView(null)}>
              <Maximize2 size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label={cursors.length >= 2 ? 'Remove Cursors' : 'Add Cursor'} tooltip onClick={() => setCursors(cursors.length >= 2 ? [] : [...cursors, cursors.length ? 1000 : 10000])}>
              <Crosshair size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label="Add Label" tooltip onClick={() => setDialog({ title: 'Add Label', submitLabel: 'Add Label', fields: [{ key: 't', label: 'Label Text', placeholder: '−3 dB corner', required: true }], onSubmit: (v) => setLabels([...labels, { f: cursors[0] ?? 10000, text: v.t }]) })}>
              <Pencil size={16} />
            </Button>
            <DotsMenu
              aria-label="Plot Actions"
              menu={
                <>
                  <MenuItem prefix={<Download size={16} />} onSelect={() => void saveTable('network.csv', netTable())}>Export Data</MenuItem>
                  <MenuItem prefix={<Upload size={16} />} onSelect={() => void saveImage('network.png')}>Export Image</MenuItem>
                  <MenuItem prefix={<ScrollText size={16} />} onSelect={() => toggleLoggingFor('Network')}>{logging ? 'Stop Logging' : 'Start Logging'}</MenuItem>
                  <MenuSeparator />
                  <MenuItem prefix={<ZoomIn size={16} />} onSelect={() => setView([2000, 50000])}>Zoom to Corner</MenuItem>
                </>
              }
            />
          </div>
        </div>
      )}
      {body}
      {cursors.length > 0 && tab === 'Bode' && (
        <Table
          compact
          caption="Cursors"
          columns={[
            { key: 'c', title: 'Cursor' },
            { key: 'f', title: 'Frequency', align: 'right' },
            { key: 'm', title: 'Magnitude', align: 'right' },
            { key: 'p', title: 'Phase', align: 'right' }
          ]}
          rows={cursors.map((f, i) => ({ c: 'X' + (i + 1), f: si(f, 'Hz', 4), m: fixed(20 * Math.log10(mag(at(f)) * s.gain), 'dB', 2), p: fixed(phaseDeg(at(f)) + s.phaseOffset, '°', 1) }))}
        />
      )}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Progress value={n} max={s.steps} aria-label="Sweep progress" />
        </div>
        <span className="text-[13px] leading-4 tabular-nums text-gray-900">
          Step {n} of {s.steps} · {si(cur ?? s.start, 'Hz')}
        </span>
      </div>
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </SplitPage>
  )
}
