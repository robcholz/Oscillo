// Impedance Analyzer (board: Impedance). Meter mode reads |Z|, phase, Rs, Xs, Cs, Q and D at one
// frequency; Sweep mode plots them across frequency, plus a Smith chart and the sweep table.
import { Button, DotsMenu, FormModal, LegendItem, Material, MenuItem, MenuSeparator, Note, StatusDot, Switch, Table, Tabs, type FormField, type StatusDotState } from '@robcholz/geist'
import { Crosshair, Download, Maximize2, Pencil, Play, ScrollText, Square, StepForward, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { useMemo, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Cursor } from '../components/Cursor'
import { fixed, si } from '../components/format'
import { Grid2, LabeledSelect, PageBar, PanelSection, SplitPage } from '../components/Page'
import { Plot, type Series } from '../components/Plot'
import { UnitInput } from '../components/UnitInput'
import { jitter, useInterval } from '../components/useInterval'
import { impedance, mag, phaseDeg, sweep, type Complex } from '../sim/network'
import { useHardware } from '../devices'
import { cdiv, cscale, csub, respond, useSweep } from '../hwsync'
import { useStore } from '../store'

const TABS = ['|Z| and Phase', 'R and X', 'Cs and Ls', 'Q and D', 'Smith', 'Data'] as const

interface ImpState {
  running: boolean
  mode: 'Meter' | 'Sweep'
  start: number
  stop: number
  steps: number
  scale: string
  amp: number
  offset: number
  freq: number
  circuit: string
  reference: number
  periods: number
  adapter: string
  comp: { open: boolean; short: boolean; load: boolean }
  set: (p: Partial<Omit<ImpState, 'set'>>) => void
}

const useImpedance = create<ImpState>()(
  persist(
    (set) => ({
      running: true,
      mode: 'Sweep',
      start: 100,
      stop: 1e6,
      steps: 201,
      scale: 'Logarithmic',
      amp: 1,
      offset: 0,
      freq: 1000,
      circuit: 'Series',
      reference: 1000,
      periods: 16,
      adapter: 'Impedance Analyzer Adapter',
      comp: { open: false, short: false, load: false },
      set: (p) => set(p)
    }),
    { name: 'oscillo.impedance', partialize: ({ set: _s, ...r }) => r }
  )
)

function derived(z: Complex, f: number) {
  const w = 2 * Math.PI * f
  const cs = z.im < 0 ? -1 / (w * z.im) : NaN
  const ls = z.im > 0 ? z.im / w : NaN
  const q = Math.abs(z.im) / Math.max(1e-12, z.re)
  return { z: mag(z), p: phaseDeg(z), rs: z.re, xs: z.im, cs, ls, q, d: 1 / q }
}

/** Smith chart: constant-resistance circles and reactance arcs, with Γ = (Z − Z0) / (Z + Z0). */
function Smith({ points, z0 = 50 }: { points: Complex[]; z0?: number }) {
  const R = 230
  const g = points.map((z) => {
    const n = { re: z.re - z0, im: z.im }
    const d = { re: z.re + z0, im: z.im }
    const den = d.re * d.re + d.im * d.im
    return { x: (n.re * d.re + n.im * d.im) / den, y: (n.im * d.re - n.re * d.im) / den }
  })
  const path = g.map((p, i) => `${i ? 'L' : 'M'}${(250 + p.x * R).toFixed(1)},${(250 - p.y * R).toFixed(1)}`).join(' ')
  const [hover, setHover] = useState<number | null>(null)
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]">
      <svg viewBox="0 0 500 500" className="size-full" role="img" aria-label="Smith chart" onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - r.left) / r.width) * 500
          const y = ((e.clientY - r.top) / r.height) * 500
          let best = 0
          let bd = Infinity
          g.forEach((p, i) => {
            const d = (250 + p.x * R - x) ** 2 + (250 - p.y * R - y) ** 2
            if (d < bd) (bd = d), (best = i)
          })
          setHover(bd < 900 ? best : null)
        }}
      >
        <circle cx={250} cy={250} r={R} fill="none" stroke="var(--gray-alpha-500)" />
        <line x1={20} y1={250} x2={480} y2={250} stroke="var(--gray-alpha-400)" />
        {[0.2, 0.5, 1, 2, 5].map((r) => (
          <circle key={r} cx={250 + (R * r) / (1 + r)} cy={250} r={R / (1 + r)} fill="none" stroke="var(--gray-alpha-400)" />
        ))}
        {[0.2, 0.5, 1, 2, 5].flatMap((x) => [x, -x]).map((x) => (
          <circle key={x} cx={250 + R} cy={250 - R / x} r={Math.abs(R / x)} fill="none" stroke="var(--gray-alpha-300)" clipPath="url(#smith-clip)" />
        ))}
        <clipPath id="smith-clip">
          <circle cx={250} cy={250} r={R} />
        </clipPath>
        <path d={path} fill="none" stroke="var(--wf-c1)" strokeWidth={2} />
        {hover !== null && <circle cx={250 + g[hover].x * R} cy={250 - g[hover].y * R} r={5} fill="var(--wf-c1)" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-small bg-background-100 px-2 py-1 text-xs tabular-nums shadow-tooltip">
          Z = {si(points[hover].re, 'Ω')} {points[hover].im < 0 ? '−' : '+'} j{si(Math.abs(points[hover].im), 'Ω')}
        </div>
      )}
    </div>
  )
}

export function Impedance() {
  const s = useImpedance()
  const app = useStore()
  const toast = app.toast
  const [tab, setTab] = useState<(typeof TABS)[number]>('|Z| and Phase')
  const [done, setDone] = useState(s.steps)
  const [tick, setTick] = useState(0)
  const [view, setView] = useState<[number, number] | null>(null)
  const [cursors, setCursors] = useState<number[]>([])
  const [labels, setLabels] = useState<{ f: number; text: string }[]>([])
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void }>(null)
  const live = s.running && app.running && !!app.device
  const log = s.scale === 'Logarithmic'

  const real = useHardware()
  useInterval(() => (s.mode === 'Sweep' ? setDone((d) => (d >= s.steps ? 1 : d + 1)) : setTick((t) => t + 1)), s.mode === 'Sweep' ? Math.max(10, 2400 / s.steps) : 400, live && !real)

  const freqs = useMemo(() => sweep(s.start, s.stop, s.steps, log), [s.start, s.stop, s.steps, log])
  // A real device: W1 drives C1, then the DUT, then C2 across the reference resistor to ground,
  // so Z = R × (C1 − C2) / C2.
  const meterFreqs = useMemo(() => [s.freq], [s.freq])
  const hwSweep = useSweep(real && live, s.mode === 'Meter' ? meterFreqs : freqs, async (f) => {
    const [v1, v2] = await respond(f, { amp: s.amp, offset: s.offset, periods: s.periods, settle: 0 })
    return cscale(cdiv(csub(v1, v2), v2), s.reference)
  })
  const simZ = useMemo(() => freqs.map((f) => impedance(f)), [freqs])
  const Z = real && s.mode === 'Sweep' ? hwSweep.pts : simZ
  const n = real && s.mode === 'Sweep' ? hwSweep.done : Math.min(done, s.steps)
  const D = Z.slice(0, n).map((z, i) => derived(z, freqs[i]))
  const fx = Float64Array.from(freqs.slice(0, n))
  const [x0, x1] = view ?? [s.start, s.stop]
  const xAxis = { min: x0, max: x1, unit: 'Hz', label: 'f', log }

  // Meter: one frequency, small noise per reading.
  const meterZ = useMemo(() => {
    if (real) return hwSweep.pts[0] ?? { re: 0, im: 0 }
    const z = impedance(s.freq)
    return { re: z.re * (1 + jitter(0.0008)), im: z.im * (1 + jitter(0.0008)) }
  }, [s.freq, tick, real, hwSweep.pts])
  const m = derived(s.mode === 'Meter' ? meterZ : Z[n - 1] ?? meterZ, s.mode === 'Meter' ? s.freq : freqs[n - 1])

  const run = () => {
    if (!app.device) return toast('No device connected', { detail: 'Connect a device, then press Run.' })
    if (!app.running) app.setRunning(true)
    s.set({ running: !s.running })
  }
  const zoom = (k: number) => {
    const c = Math.sqrt(x0 * x1)
    const r = Math.min(s.stop / s.start, (x1 / x0) ** k)
    let a = Math.max(s.start, c / Math.sqrt(r))
    let b = a * r
    if (b > s.stop) (b = s.stop), (a = b / r)
    setView(a <= s.start * 1.0001 && b >= s.stop * 0.9999 ? null : [a, b])
  }
  const fromFx = (f: number) => (log ? 10 ** (Math.log10(x0) + f * (Math.log10(x1) - Math.log10(x0))) : x0 + f * (x1 - x0))
  const overlay = (toPct: (x: number, y: number) => { left: string; top: string }) => (
    <>
      {cursors.map((f, i) => (
        <Cursor key={i} label={'X' + (i + 1)} left={toPct(f, 0).left} onMove={(p) => setCursors(cursors.map((c, k) => (k === i ? fromFx(p) : c)))} />
      ))}
      {labels.map((l, i) => (
        <span key={i} className="absolute z-[2] h-[22px] rounded-small bg-background-100 px-2 text-xs leading-[22px] shadow-[0_0_0_1px_var(--gray-alpha-600)]" style={{ left: toPct(l.f, 0).left, bottom: 16 + (i % 3) * 28 }}>
          {l.text}
        </span>
      ))}
    </>
  )

  const line = (id: string, name: string, color: string, unit: string, y: (d: ReturnType<typeof derived>) => number): Series => ({ id, name, color, unit, x: fx, y: Float64Array.from(D, y) })
  const h = 'calc(260px + max(0px, (100vh - 900px) * 0.5))'
  let body
  if (tab === '|Z| and Phase')
    body = (
      <>
        <Plot x={xAxis} y={{ min: 10, max: 10e6, unit: 'Ω', log: true, divisions: 6 }} series={[line('z', '|Z|', 'var(--wf-c1)', 'Ω', (d) => d.z)]} ariaLabel="Impedance magnitude" overlay={overlay} height={h} />
        <Plot x={xAxis} y={{ min: -90, max: 90, unit: '°', divisions: 4 }} series={[line('p', 'Phase', 'var(--wf-c3)', '°', (d) => d.p)]} ariaLabel="Impedance phase" height="calc(150px + max(0px, (100vh - 900px) * 0.3))" />
      </>
    )
  else if (tab === 'R and X')
    body = (
      <>
        <div className="flex flex-wrap gap-2">
          <LegendItem color="var(--wf-c1)" label="Rs" />
          <LegendItem color="var(--wf-c2)" label="|Xs|" />
        </div>
        <Plot x={xAxis} y={{ min: 10, max: 10e6, unit: 'Ω', log: true, divisions: 6 }} series={[line('r', 'Rs', 'var(--wf-c1)', 'Ω', (d) => Math.max(10, d.rs)), line('x', '|Xs|', 'var(--wf-c2)', 'Ω', (d) => Math.abs(d.xs))]} ariaLabel="Resistance and reactance" overlay={overlay} />
      </>
    )
  else if (tab === 'Cs and Ls')
    body = (
      <>
        <div className="flex flex-wrap gap-2">
          <LegendItem color="var(--wf-c3)" label="Cs" />
          <LegendItem color="var(--wf-c4)" label="Ls" />
        </div>
        <Plot x={xAxis} y={{ min: 1e-12, max: 1e-6, unit: 'F', log: true, divisions: 6 }} series={[line('c', 'Cs', 'var(--wf-c3)', 'F', (d) => d.cs), line('l', 'Ls', 'var(--wf-c4)', 'H', (d) => d.ls)]} ariaLabel="Series capacitance and inductance" overlay={overlay} />
      </>
    )
  else if (tab === 'Q and D')
    body = (
      <>
        <div className="flex flex-wrap gap-2">
          <LegendItem color="var(--wf-c1)" label="Q" />
          <LegendItem color="var(--wf-c2)" label="D" />
        </div>
        <Plot x={xAxis} y={{ min: 0.001, max: 1000, unit: '', log: true, divisions: 6 }} series={[line('q', 'Q', 'var(--wf-c1)', '', (d) => d.q), line('d', 'D', 'var(--wf-c2)', '', (d) => d.d)]} ariaLabel="Quality and dissipation factor" overlay={overlay} />
      </>
    )
  else if (tab === 'Smith')
    body = (
      <>
        <div className="flex flex-wrap gap-2">
          <LegendItem color="var(--wf-c1)" label="Z / 50 Ω" />
        </div>
        <Smith points={Z.slice(0, n)} />
      </>
    )
  else
    body = (
      <Table
        compact
        caption="Impedance sweep data"
        columns={[
          { key: 'f', title: 'Frequency', align: 'right' },
          { key: 'z', title: '|Z|', align: 'right', mono: true },
          { key: 'p', title: 'Phase', align: 'right', mono: true },
          { key: 'r', title: 'Rs', align: 'right', mono: true },
          { key: 'x', title: 'Xs', align: 'right', mono: true },
          { key: 'c', title: 'Cs', align: 'right', mono: true }
        ]}
        rows={D.map((d, i) => ({ f: si(freqs[i], 'Hz'), z: si(d.z, 'Ω'), p: fixed(d.p, '°', 2), r: si(d.rs, 'Ω'), x: si(d.xs, 'Ω'), c: Number.isFinite(d.cs) ? si(d.cs, 'F') : '—' }))}
      />
    )

  const compCount = Object.values(s.comp).filter(Boolean).length
  const compDot: { state: StatusDotState; label: string } = compCount === 3 ? { state: 'READY', label: 'Open, Short and Load applied' } : compCount ? { state: 'BUILDING', label: `${compCount} of 3 steps done` } : { state: 'QUEUED', label: 'Not compensated' }
  const compStep = (k: keyof ImpState['comp'], what: string) => {
    if (!app.device) return toast('No device connected', { detail: 'Connect a device, then run compensation.' })
    s.set({ comp: { ...s.comp, [k]: true } })
    toast(`${k[0].toUpperCase() + k.slice(1)} compensation saved`, { detail: what })
  }

  const panel = (
    <>
      <PanelSection title="Sweep">
        <Grid2>
          <UnitInput label="Start" value={s.start} suffix="Hz" min={1} max={s.stop / 2} onCommit={(start) => { setView(null); setDone(1); s.set({ start }) }} />
          <UnitInput label="Stop" value={s.stop} scale={1e6} suffix="MHz" min={s.start * 2} max={50e6} onCommit={(stop) => { setView(null); setDone(1); s.set({ stop }) }} />
          <UnitInput label="Steps" value={s.steps} integer min={2} max={10000} onCommit={(steps) => { setDone(1); s.set({ steps }) }} />
          <LabeledSelect label="Scale" value={s.scale} options={['Logarithmic', 'Linear']} onValueChange={(scale) => { setView(null); s.set({ scale }) }} />
          <UnitInput label="Amplitude" value={s.amp} suffix="V" min={0.001} max={5} onCommit={(amp) => s.set({ amp })} />
          <UnitInput label="Offset" value={s.offset} suffix="V" min={-5} max={5} onCommit={(offset) => s.set({ offset })} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Meter">
        <Grid2>
          <UnitInput label="Frequency" value={s.freq} scale={1000} suffix="kHz" min={1} max={50e6} onCommit={(freq) => s.set({ freq })} />
          <LabeledSelect label="Circuit" value={s.circuit} options={['Series', 'Parallel']} onValueChange={(circuit) => s.set({ circuit })} />
          <UnitInput label="Reference" value={s.reference} scale={1000} suffix="kΩ" min={1} onCommit={(reference) => s.set({ reference })} />
          <UnitInput label="Min Periods" value={s.periods} integer min={1} onCommit={(periods) => s.set({ periods })} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Compensation">
        <div className="flex flex-wrap gap-2">
          <Button size="small" type="secondary" onClick={() => compStep('open', 'Leave the probes open and keep them apart.')}>
            Open
          </Button>
          <Button size="small" type="secondary" onClick={() => compStep('short', 'Probes shorted together.')}>
            Short
          </Button>
          <Button size="small" type="secondary" onClick={() => compStep('load', 'Measured the 1 kΩ reference load.')}>
            Load
          </Button>
          <Button size="small" type="tertiary" disabled={!compCount} onClick={() => { s.set({ comp: { open: false, short: false, load: false } }); toast('Compensation cleared') }}>
            Clear
          </Button>
        </div>
        <StatusDot state={compDot.state} label={compDot.label} />
      </PanelSection>
      <PanelSection title="Adapter">
        <LabeledSelect label="Adapter" value={s.adapter} options={['Impedance Analyzer Adapter', 'None']} onValueChange={(adapter) => s.set({ adapter })} />
        <Note type="secondary" size="small">
          The adapter switches reference resistors through Static I/O.
        </Note>
      </PanelSection>
    </>
  )

  const readout = [
    { k: s.circuit === 'Series' ? '|Z|' : '|Z| (Parallel)', v: si(m.z, 'Ω', 4) },
    { k: 'Phase', v: fixed(m.p, '°', 2) },
    { k: 'Rs', v: si(m.rs, 'Ω', 4) },
    { k: 'Xs', v: si(m.xs, 'Ω', 4) },
    { k: Number.isFinite(m.cs) ? 'Cs' : 'Ls', v: Number.isFinite(m.cs) ? si(m.cs, 'F', 4) : si(m.ls, 'H', 4) },
    { k: 'Q', v: fixed(m.q, '', 3) },
    { k: 'D', v: fixed(m.d, '', 3) }
  ]

  return (
    <SplitPage
      bar={
        <PageBar title="Impedance Analyzer" status={<StatusDot state={live ? (s.mode === 'Sweep' && n < s.steps ? 'BUILDING' : 'READY') : 'QUEUED'} label={live ? (s.mode === 'Meter' ? `Measuring at ${si(s.freq, 'Hz')}` : n < s.steps ? 'Sweeping' : 'Sweep Done') : 'Stopped'} />}>
          <Switch aria-label="Mode" value={s.mode} options={['Meter', 'Sweep'] as const} onChange={(mode) => s.set({ mode })} />
          <Button size="small" type="secondary" prefix={<StepForward size={16} />} onClick={() => { if (!app.device) return toast('No device connected', { detail: 'Connect a device, then press Single.' }); s.set({ running: false }); setDone(s.steps); setTick(tick + 1) }}>
            Single
          </Button>
          <Button size="small" prefix={live ? <Square size={16} /> : <Play size={16} />} onClick={run} tooltipKeys={['Space']}>
            {live ? 'Stop' : 'Run'}
          </Button>
        </PageBar>
      }
      panelId="impedance"
      panel={panel}
    >
      <Material className="grid grid-cols-[repeat(auto-fit,minmax(max(110px,calc(25%-12px)),1fr))] gap-4 p-4">
        {readout.map((r) => (
          <div key={r.k}>
            <p className="m-0 text-[13px] leading-4 text-gray-900">{r.k}</p>
            <p className="m-0 mt-1 text-2xl font-semibold tabular-nums tracking-[-0.96px]">{r.v}</p>
          </div>
        ))}
      </Material>
      {s.mode === 'Sweep' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs tabs={TABS.map((t) => ({ title: t, value: t }))} selected={tab} setSelected={(v) => setTab(v as (typeof TABS)[number])} />
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
              <Button type="tertiary" size="small" svgOnly aria-label={cursors.length >= 2 ? 'Remove Cursors' : 'Add Cursor'} tooltip onClick={() => setCursors(cursors.length >= 2 ? [] : [...cursors, cursors.length ? 100e3 : 1000])}>
                <Crosshair size={16} />
              </Button>
              <Button type="tertiary" size="small" svgOnly aria-label="Add Label" tooltip onClick={() => setDialog({ title: 'Add Label', submitLabel: 'Add Label', fields: [{ key: 't', label: 'Label Text', placeholder: 'Self-resonance', required: true }], onSubmit: (v) => setLabels([...labels, { f: cursors[0] ?? 10000, text: v.t }]) })}>
                <Pencil size={16} />
              </Button>
              <DotsMenu
                aria-label="Plot Actions"
                menu={
                  <>
                    <MenuItem prefix={<Download size={16} />} onSelect={() => toast('Exported impedance.csv', { detail: `${n} steps.` })}>Export Data</MenuItem>
                    <MenuItem prefix={<Upload size={16} />} onSelect={() => toast('Exported impedance.png')}>Export Image</MenuItem>
                    <MenuItem prefix={<ScrollText size={16} />} onSelect={() => app.go('logger')}>Start Logging</MenuItem>
                    <MenuSeparator />
                    <MenuItem prefix={<ZoomIn size={16} />} onSelect={() => setView([1000, 100e3])}>Zoom to 1 kHz – 100 kHz</MenuItem>
                  </>
                }
              />
            </div>
          </div>
          {body}
        </>
      ) : (
        <Note type="secondary" size="small">
          Meter mode reads the DUT at {si(s.freq, 'Hz')}. Switch to Sweep to plot it across frequency.
        </Note>
      )}
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </SplitPage>
  )
}
