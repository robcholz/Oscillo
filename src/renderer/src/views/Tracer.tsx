// Curve Tracer (board: Tracer). IV curves of a transistor family, a diode or a resistor through the
// transistor tester adapter.
import { Button, LegendItem, Note, StatusDot } from '@robcholz/geist'
import { Play, Square, StepForward } from 'lucide-react'
import { useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { si } from '../components/format'
import { Grid2, LabeledSelect, PageBar, PanelSection, SplitPage } from '../components/Page'
import { Plot, type Series } from '../components/Plot'
import { UnitInput } from '../components/UnitInput'
import { jitter, useInterval } from '../components/useInterval'
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
  set: (p: Partial<Omit<TracerState, 'set'>>) => void
}

const useTracer = create<TracerState>()(
  persist((set) => ({ running: true, device: 'NPN', vmax: 5, ibStart: 10e-6, ibStep: 10e-6, steps: 5, hidden: [], set: (p) => set(p) }), {
    name: 'oscillo.tracer',
    partialize: ({ set: _s, ...r }) => r
  })
)

/** Collector current: β·IB with saturation below ~0.2 V and the Early effect (VA = 80 V). */
const ic = (vce: number, ib: number) => 180 * ib * (1 - Math.exp(-vce / 0.08)) * (1 + vce / 80)
const diode = (v: number) => 1e-12 * (Math.exp(v / (1.8 * 0.02585)) - 1)

export function Tracer() {
  const s = useTracer()
  const app = useStore()
  const [, setTick] = useState(0)
  const live = s.running && app.running && !!app.device
  useInterval(() => setTick((t) => t + 1), 500, live)

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
      y: Float64Array.from(vx, (v) => (pnp ? -1 : 1) * ic(Math.abs(v), s.ibStart + k * s.ibStep) * (1 + (live ? jitter(0.004) : 0)))
    }))
    yMax = ic(vmax, s.ibStart + (s.steps - 1) * s.ibStep) * 1.15
  } else if (s.device === 'Diode') {
    legend = ['1N4148']
    series = [{ id: 'd', name: '1N4148', color: COLORS[0], unit: 'A', x: vx, y: Float64Array.from(vx, (v) => Math.min(0.05, diode(v)) * (1 + (live ? jitter(0.004) : 0))) }]
    yMax = 0.05
  } else {
    legend = ['1 kΩ']
    series = [{ id: 'r', name: '1 kΩ', color: COLORS[0], unit: 'A', x: vx, y: Float64Array.from(vx, (v) => (v / 1000) * (1 + (live ? jitter(0.002) : 0))) }]
    yMax = vmax / 1000
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
        <PageBar title="Curve Tracer" status={<StatusDot state={live ? 'READY' : 'QUEUED'} label={live ? 'Tracing' : 'Stopped'} />}>
          <Button size="small" type="secondary" prefix={<StepForward size={16} />} onClick={() => { s.set({ running: false }); setTick((t) => t + 1) }}>
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
            <Note type="secondary" size="small">
              Uses Scope, both Wavegen channels, Supplies and Static I/O through the transistor tester adapter.
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
      {bjt && (
        <span className="text-[13px] tabular-nums text-gray-900">
          β ≈ {Math.round(ic(Math.min(2, vmax), s.ibStart) / s.ibStart)} at VCE 2 V · Early voltage ≈ 80 V
        </span>
      )}
    </SplitPage>
  )
}
