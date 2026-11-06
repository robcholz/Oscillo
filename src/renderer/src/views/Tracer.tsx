// Curve Tracer (board: Tracer). IV curves of a transistor family, a diode or a resistor through the
// transistor tester adapter.
import { Button, LegendItem, Note, StatusDot } from '@robcholz/geist'
import { Play, Square, StepForward } from 'lucide-react'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { si } from '../components/format'
import { Grid2, LabeledSelect, PageBar, PanelSection, SplitPage } from '../components/Page'
import { Plot, type Series } from '../components/Plot'
import { UnitInput } from '../components/UnitInput'
import { hw } from '../devices'
import { resync } from '../hwsync'
import { useStore } from '../store'

const COLORS = ['var(--wf-c1)', 'var(--wf-c2)', 'var(--wf-c3)', 'var(--wf-c5)', 'var(--wf-c4)']
type Kind = 'NPN' | 'PNP' | 'Diode' | 'Resistor'

interface TracerState {
  running: boolean
  device: Kind
  vmax: number
  ibStart: number
  ibStep: number
  steps: number
  hidden: number[]
  /** Current-sense resistor between C2 and ground, in ohms. */
  rsense: number
  /** Base resistor from W2, in ohms. */
  rbase: number
  set: (p: Partial<Omit<TracerState, 'set'>>) => void
}

const useTracer = create<TracerState>()(
  persist((set) => ({ running: true, device: 'NPN', vmax: 5, ibStart: 10e-6, ibStep: 10e-6, steps: 5, hidden: [], rsense: 100, rbase: 100e3, set: (p) => set(p) }), {
    name: 'oscillo.tracer',
    partialize: ({ set: _s, ...r }) => r
  })
)

/** Largest |I| in the measured curves, at least `min`, with headroom. */
const peak = (c: Float64Array[] | null, min: number) => Math.max(min, ...(c ?? []).map((x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0))) * 1.15

/** Bins a captured V–I loop into n points across 0…vmax (or −vmax…0), averaging each bin. */
function binIV(v: Float64Array, i: Float64Array, vmax: number, n: number): Float64Array {
  const sum = new Float64Array(n)
  const cnt = new Float64Array(n)
  for (let k = 0; k < v.length; k++) {
    const b = Math.round((v[k] / vmax) * (n - 1))
    if (b >= 0 && b < n) (sum[b] += i[k]), cnt[b]++
  }
  const out = new Float64Array(n)
  let last = 0
  for (let b = 0; b < n; b++) out[b] = last = cnt[b] ? sum[b] / cnt[b] : last
  return out
}

/**
 * Real hardware: W1 ramps 0 → V max through the DUT into C2's sense resistor (C1 at the top, C2 at
 * the resistor), so V = C1 − C2 and I = C2 / R. For a transistor W1 is the collector supply and W2
 * drives the base through its resistor, one base current per curve.
 */
async function trace(st: TracerState, n: number): Promise<Float64Array[]> {
  const sign = st.device === 'PNP' ? -1 : 1
  const vmax = st.device === 'Diode' ? Math.min(st.vmax, 1) : st.vmax
  const bjt = st.device === 'NPN' || st.device === 'PNP'
  const curves: Float64Array[] = []
  const f = 50
  for (let k = 0; k < (bjt ? st.steps : 1); k++) {
    if (bjt) await hw!.wavegen(1, { func: 'DC', frequency: 0, amplitude: 0, offset: sign * (0.65 + (st.ibStart + k * st.ibStep) * st.rbase), symmetry: 50, phase: 0 })
    // Drive past V max so the DUT itself reaches it, despite the drop across the sense resistor.
    const drive = Math.min(5, vmax * 1.2)
    await hw!.wavegen(0, { func: 'Triangle', frequency: f, amplitude: (sign * drive) / 2, offset: (sign * drive) / 2, symmetry: 50, phase: 0 })
    await new Promise((r) => setTimeout(r, 40))
    const r = await hw!.scope({ channels: [0, 1], rate: 200 * f * 10, samples: 2000, range: { 0: 10, 1: 10 } })
    const v = Float64Array.from(r.data[0], (x, j) => sign * (x - r.data[1][j]))
    const i = Float64Array.from(r.data[1], (x) => sign * (x / st.rsense))
    curves.push(Float64Array.from(binIV(v, i, vmax, n), (x) => sign * x))
  }
  return curves
}

export function Tracer() {
  const s = useTracer()
  const app = useStore()
  const [tick, setTick] = useState(0)
  const live = s.running && app.running && !!app.device
  const [measured, setMeasured] = useState<Float64Array[] | null>(null)
  const [busy, setBusy] = useState(false)
  // Traces back to back while running, or once for Single (tick < 0); when tracing stops the generator returns to its settings.
  useEffect(() => {
    if (!(live || tick < 0)) return
    let alive = true
    void (async () => {
      try {
        while (alive) {
          setBusy(true)
          const c = await trace(useTracer.getState(), 200)
          if (alive) setMeasured(c)
          if (!useTracer.getState().running) break
        }
      } catch (e) {
        if (alive) app.toast('Trace failed', { detail: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      } finally {
        setBusy(false)
        await Promise.all([hw?.wavegenStop(0), hw?.wavegenStop(1)]).catch(() => undefined)
        resync()
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, tick])

  const N = 200
  const pnp = s.device === 'PNP'
  const vmax = s.device === 'Diode' ? Math.min(s.vmax, 1) : s.vmax
  const vx = Float64Array.from({ length: N }, (_, i) => (i / (N - 1)) * vmax * (pnp ? -1 : 1))
  let series: Series[]
  let yMax: number
  let legend: string[]
  if (s.device === 'NPN' || s.device === 'PNP') {
    legend = Array.from({ length: s.steps }, (_, k) => si(s.ibStart + k * s.ibStep, 'A'))
    series = legend.map((name, k) => ({
      id: 'c' + k,
      name: 'IB ' + name,
      color: COLORS[k % COLORS.length],
      unit: 'A',
      hidden: s.hidden.includes(k),
      x: vx,
      y: measured?.[k] ?? new Float64Array(N)
    }))
    yMax = peak(measured, 1e-3)
  } else if (s.device === 'Diode') {
    legend = ['Diode']
    series = [{ id: 'd', name: 'Diode', color: COLORS[0], unit: 'A', x: vx, y: measured?.[0] ?? new Float64Array(N) }]
    yMax = peak(measured, 1e-3)
  } else {
    legend = ['Resistor']
    series = [{ id: 'r', name: legend[0], color: COLORS[0], unit: 'A', x: vx, y: measured?.[0] ?? new Float64Array(N) }]
    yMax = peak(measured, 1e-3)
  }
  const nice = (v: number) => {
    const p = 10 ** Math.floor(Math.log10(v))
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v)!
  }
  const ym = nice(yMax)

  const run = () => {
    if (!app.device) return app.toast('No device connected', { detail: 'Connect a device, then press Run.' })
    if (!app.running) app.setRunning(true)
    s.set({ running: !s.running })
  }
  const bjt = s.device === 'NPN' || s.device === 'PNP'

  return (
    <SplitPage
      bar={
        <PageBar title="Curve Tracer" status={<StatusDot state={live || busy ? 'READY' : 'QUEUED'} label={live || busy ? 'Tracing' : 'Stopped'} />}>
          <Button size="small" type="secondary" prefix={<StepForward size={16} />} onClick={() => { if (!app.device) return app.toast('No device connected', { detail: 'Connect a device, then press Single.' }); s.set({ running: false }); setTick((t) => -Math.abs(t) - 1) }}>
            Single
          </Button>
          <Button size="small" prefix={live ? <Square size={16} /> : <Play size={16} />} onClick={run} tooltipKeys={['Space']}>
            {live ? 'Stop' : 'Run'}
          </Button>
        </PageBar>
      }
      panelId="tracer"
      panel={
        <>
          <PanelSection title="Sweep">
            <Grid2>
              <LabeledSelect label="Device" value={s.device} options={['NPN', 'PNP', 'Diode', 'Resistor']} onValueChange={(v) => s.set({ device: v as Kind, hidden: [] })} />
              <UnitInput label={bjt ? 'VCE Max' : 'V Max'} value={s.vmax} suffix="V" min={0.1} max={10} onCommit={(vmax) => s.set({ vmax })} />
              <UnitInput label="IB Start" value={s.ibStart} scale={1e-6} suffix="µA" min={1e-7} max={1e-3} disabled={!bjt} onCommit={(ibStart) => s.set({ ibStart })} />
              <UnitInput label="IB Step" value={s.ibStep} scale={1e-6} suffix="µA" min={1e-7} max={1e-3} disabled={!bjt} onCommit={(ibStep) => s.set({ ibStep })} />
              <UnitInput label="Steps" value={s.steps} integer min={1} max={10} disabled={!bjt} onCommit={(steps) => s.set({ steps, hidden: [] })} />
            </Grid2>
          </PanelSection>
          <PanelSection title="Adapter">
            <Grid2>
              <UnitInput label="Sense Resistor" value={s.rsense} suffix="Ω" min={1} max={100e3} onCommit={(rsense) => s.set({ rsense })} />
              <UnitInput label="Base Resistor" value={s.rbase} scale={1e3} suffix="kΩ" min={1e3} max={10e6} disabled={!bjt} onCommit={(rbase) => s.set({ rbase })} />
            </Grid2>
            <Note type="secondary" size="small">
              W1 drives the DUT, C1 reads its top and C2 the sense resistor to ground. For transistors, W2 drives the base through the base resistor.
            </Note>
          </PanelSection>
        </>
      }
    >
      <div className="flex flex-wrap gap-2">
        {legend.map((l, k) => (
          <LegendItem key={k} size="medium" color={COLORS[k % COLORS.length]} label={bjt && k === 0 ? `IB ${l}` : l} pressed={!s.hidden.includes(k)} onToggle={(on) => s.set({ hidden: on ? s.hidden.filter((x) => x !== k) : [...s.hidden, k] })} />
        ))}
      </div>
      <Plot
        x={{ min: pnp ? -vmax : 0, max: pnp ? 0 : vmax, unit: 'V', label: bjt ? 'VCE' : 'V' }}
        y={{ min: pnp ? -ym : 0, max: pnp ? 0 : ym, unit: 'A' }}
        series={series}
        ariaLabel="IV curves"
        height="calc(460px + max(0px, (100vh - 900px) * 0.8))"
      />
    </SplitPage>
  )
}
