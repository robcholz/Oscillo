// Waveform Generator (board: Wavegen). Two channels with a live preview, the mode tabs from
// WaveForms (Simple → Play), sweep, modulation and a custom waveform editor.
import { Button, DotsMenu, Material, MenuItem, MenuSeparator, Note, StatusDot, Switch, Tabs, Toggle } from '@robcholz/geist'
import { ArrowUpDown, ChevronLeft, ChevronRight, Copy, Play, RefreshCw, Square, Upload } from 'lucide-react'
import { useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { LabeledInput, LabeledSelect, PageBar, ScrollPage } from '../components/Page'
import { Plot } from '../components/Plot'
import { UnitInput } from '../components/UnitInput'
import { samples, type WaveType } from '../sim/wave'
import { follow, pushWave } from '../hwsync'
import { useStore } from '../store'

const TYPES = [
  ...(['Sine', 'Square', 'Triangle', 'Ramp Up', 'Ramp Down', 'Noise', 'Trapezium', 'Sine Power', 'DC'] as const).map((v) => ({ value: v, label: v, group: 'Standard' })),
  ...(['Custom', 'Play'] as const).map((v) => ({ value: v, label: v, group: 'From Data' }))
]
const TABS = ['Simple', 'Basic', 'Custom', 'Sweep', 'Advanced', 'Play'] as const

interface Ch {
  run: boolean
  out: boolean
  type: WaveType
  freq: number
  amp: number
  offset: number
  sym: number
  phase: number
  trigger: string
  wait: number
  runMode: string
  repeat: string
  idle: string
  repeatTrigger: boolean
}

const def1: Ch = { run: true, out: true, type: 'Sine', freq: 1000, amp: 2, offset: 0, sym: 50, phase: 0, trigger: 'None', wait: 0, runMode: 'Continuous', repeat: 'Infinite', idle: 'Offset', repeatTrigger: false }
const def2: Ch = { ...def1, run: false, out: true, type: 'Square', amp: 1.65, offset: 1.65, idle: 'Initial' }

interface WG {
  tab: (typeof TABS)[number]
  sync: 'Independent' | 'Synchronized' | 'Auto Sync'
  ch: [Ch, Ch]
  sweep: { on: boolean; start: number; stop: number; time: number; scale: string; dampStart: number; dampStop: number }
  mod: { kind: 'Off' | 'AM' | 'FM'; carrier: string; type: string; freq: number; index: number; offset: number; phase: number }
  custom: { points: number[]; past: number[][]; future: number[][]; formula: string; n: number; rate: string }
  set: (p: Partial<WG>) => void
  setCh: (i: 0 | 1, p: Partial<Ch>) => void
}

export const useWavegen = create<WG>()(
  persist(
    (set, get) => ({
      tab: 'Basic',
      sync: 'Independent',
      ch: [def1, def2],
      sweep: { on: false, start: 100, stop: 10000, time: 1, scale: 'Linear', dampStart: 100, dampStop: 10 },
      mod: { kind: 'AM', carrier: 'Channel 1', type: 'Sine', freq: 10, index: 50, offset: 0, phase: 0 },
      custom: { points: [0, 0.6, 0.4, 0.8, 0.1, -0.6, -0.3, -0.8, -0.1, 0.3, 0], past: [], future: [], formula: 'Math.sin(2 * Math.PI * x) * Math.exp(-3 * x)', n: 1024, rate: 'Use Frequency' },
      set: (p) => set(p),
      setCh: (i, p) => {
        const ch = get().ch.slice() as [Ch, Ch]
        ch[i] = { ...ch[i], ...p }
        set({ ch })
      }
    }),
    { name: 'oscillo.wavegen', version: 1 }
  )
)

const COLOR = ['var(--wf-c1)', 'var(--wf-c2)']

function Channel({ i }: { i: 0 | 1 }) {
  const w = useWavegen()
  const app = useStore()
  const c = w.ch[i]
  const live = c.run && app.running && !!app.device
  const name = `Channel ${i + 1}`
  const other = (1 - i) as 0 | 1
  const pv = samples(c.type, { ...c, custom: w.custom.points })
  const span = Math.max(Math.abs(c.offset) + Math.abs(c.amp), 0.5)
  const lim = Math.ceil(span * 2) / 2
  return (
    <Material className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="h-0.5 w-3" style={{ background: COLOR[i] }} />
          <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">{name}</h2>
          <StatusDot state={live ? 'READY' : c.out ? 'QUEUED' : 'CANCELED'} label={live ? 'Running' : c.out ? 'Ready' : 'Output Off'} />
        </div>
        <div className="flex items-center gap-2">
          <Toggle checked={c.out} onChange={(out) => w.setCh(i, { out })}>
            Output
          </Toggle>
          <Button
            type="secondary"
            size="small"
            prefix={c.run ? <Square size={16} /> : <Play size={16} />}
            onClick={() => {
              w.setCh(i, { run: !c.run, out: c.run ? c.out : true })
              app.toast(c.run ? `${name} stopped` : `${name} running`, c.run ? undefined : { detail: `${c.type} ${c.freq} Hz, ${c.amp} V` })
            }}
          >
            {c.run ? 'Stop' : 'Run'}
          </Button>
          <DotsMenu
            aria-label={`${name} Actions`}
            menu={
              <>
                <MenuItem prefix={<Copy size={16} />} onSelect={() => { w.setCh(other, { ...c, run: w.ch[other].run }); app.toast(`${name} copied to Channel ${other + 1}`) }}>
                  Copy to Other Channel
                </MenuItem>
                <MenuItem prefix={<ArrowUpDown size={16} />} onSelect={() => { w.set({ ch: [w.ch[1], w.ch[0]] }); app.toast('Channels swapped') }}>
                  Swap Channels
                </MenuItem>
                <MenuSeparator />
                <MenuItem prefix={<RefreshCw size={16} />} onSelect={() => { w.setCh(i, i === 0 ? def1 : def2); app.toast(`${name} reset`) }}>
                  Reset Channel
                </MenuItem>
              </>
            }
          />
        </div>
      </div>
      <Plot
        height="160px"
        x={{ min: 0, max: 2 / c.freq, unit: 's', divisions: 4 }}
        y={{ min: -lim, max: lim, unit: 'V', divisions: 4 }}
        series={[{ id: 'w', name, color: COLOR[i], x: pv.t, y: pv.v, opacity: c.out ? 1 : 0.4 }]}
        ariaLabel={`${name} preview`}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(max(104px,calc(33.333%-12px)),1fr))] gap-3">
        <LabeledSelect label="Type" value={c.type} onValueChange={(v) => w.setCh(i, { type: v as WaveType })} options={TYPES} />
        <UnitInput label="Frequency" value={c.freq} suffix="Hz" min={0.001} max={50e6} onCommit={(v) => w.setCh(i, { freq: v })} />
        <UnitInput label="Amplitude" value={c.amp} suffix="V" min={0} max={5} onCommit={(v) => w.setCh(i, { amp: v })} disabled={c.type === 'DC'} />
        <UnitInput label="Offset" value={c.offset} suffix="V" min={-5} max={5} onCommit={(v) => w.setCh(i, { offset: v })} />
        <UnitInput label="Symmetry" value={c.sym} suffix="%" min={0} max={100} onCommit={(v) => w.setCh(i, { sym: v })} disabled={w.tab === 'Simple'} />
        <UnitInput label="Phase" value={c.phase} suffix="°" min={-360} max={360} onCommit={(v) => w.setCh(i, { phase: v })} disabled={w.tab === 'Simple'} />
      </div>
      {w.tab !== 'Simple' && (
        <div className="pt-3 shadow-[inset_0_1px_0_var(--gray-alpha-400)]">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(max(104px,calc(33.333%-12px)),1fr))] gap-3">
            <LabeledSelect label="Trigger" value={c.trigger} onValueChange={(v) => w.setCh(i, { trigger: v })} options={['None', 'Manual', 'External 1', 'External 2', 'Scope', i === 0 ? 'Wavegen 2' : 'Wavegen 1']} />
            <UnitInput label="Wait" value={c.wait} suffix="s" min={0} onCommit={(v) => w.setCh(i, { wait: v })} />
            <LabeledSelect label="Run" value={c.runMode} onValueChange={(v) => w.setCh(i, { runMode: v })} options={['Continuous', 'Timed']} />
            <LabeledSelect label="Repeat" value={c.repeat} onValueChange={(v) => w.setCh(i, { repeat: v })} options={['Infinite', 'Count']} />
            <LabeledSelect label="Idle Output" value={c.idle} onValueChange={(v) => w.setCh(i, { idle: v })} options={['Offset', 'Initial', 'Disabled']} />
          </div>
        </div>
      )}
      {w.tab !== 'Simple' && (
        <Toggle checked={c.repeatTrigger} onChange={(v) => w.setCh(i, { repeatTrigger: v })}>
          Repeat Trigger on Each Cycle
        </Toggle>
      )}
    </Material>
  )
}

function CustomEditor() {
  const w = useWavegen()
  const app = useStore()
  const cw = w.custom
  const [drag, setDrag] = useState<number | null>(null)
  const edit = (points: number[]): void => w.set({ custom: { ...cw, points, past: [...cw.past.slice(-30), cw.points], future: [] } })
  return (
    <Material className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold leading-5 tracking-[-0.28px]">Custom Waveform · wave-01</h2>
        <div className="flex gap-1">
          <Button type="tertiary" size="small" svgOnly aria-label="Undo" tooltip tooltipKeys={['⌘', 'Z']} disabled={!cw.past.length} onClick={() => w.set({ custom: { ...cw, points: cw.past[cw.past.length - 1], past: cw.past.slice(0, -1), future: [cw.points, ...cw.future] } })}>
            <ChevronLeft size={16} />
          </Button>
          <Button type="tertiary" size="small" svgOnly aria-label="Redo" tooltip tooltipKeys={['⇧', '⌘', 'Z']} disabled={!cw.future.length} onClick={() => w.set({ custom: { ...cw, points: cw.future[0], future: cw.future.slice(1), past: [...cw.past, cw.points] } })}>
            <ChevronRight size={16} />
          </Button>
          <Button type="tertiary" size="small" prefix={<Upload size={16} />} onClick={() => app.toast('Imported wave-01.csv', { detail: '1,024 samples' })}>
            Import CSV
          </Button>
          <Button type="secondary" size="small" onClick={() => { w.setCh(0, { type: 'Custom' }); app.toast('Custom waveform applied to Channel 1') }}>
            Apply to Channel 1
          </Button>
        </div>
      </div>
      <div
        className="relative h-[200px] cursor-crosshair overflow-hidden rounded-small shadow-[0_0_0_1px_var(--gray-alpha-400)]"
        onPointerMove={(e) => {
          if (drag === null) return
          const r = e.currentTarget.getBoundingClientRect()
          const y = Math.max(-1, Math.min(1, 1 - ((e.clientY - r.top) / r.height) * 2))
          const pts = cw.points.slice()
          pts[drag] = Math.round(y * 100) / 100
          w.set({ custom: { ...cw, points: pts } })
        }}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label="Custom waveform with editable sample points" className="absolute inset-0 size-full">
          {[50, 100, 150].map((y) => (
            <line key={y} x1={0} x2={1000} y1={y} y2={y} stroke={y === 100 ? 'var(--gray-alpha-400)' : 'var(--gray-alpha-200)'} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={cw.points.map((p, i) => `${i ? 'L' : 'M'}${(i / (cw.points.length - 1)) * 1000},${100 - p * 100}`).join(' ')} fill="none" stroke="var(--gray-1000)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {cw.points.map((p, i) =>
          i === 0 || i === cw.points.length - 1 ? null : (
            <button
              key={i}
              type="button"
              aria-label={`Point ${i}, ${p.toFixed(2)} V. Drag or use arrow keys`}
              className="absolute -ml-1.5 -mt-1.5 size-3 cursor-ns-resize rounded-full bg-[var(--wf-c2)] shadow-[0_0_0_2px_var(--background-100)] kbd-focus:shadow-focus-ring"
              style={{ left: (i / (cw.points.length - 1)) * 100 + '%', top: (0.5 - p / 2) * 100 + '%' }}
              onPointerDown={(e) => {
                e.preventDefault()
                setDrag(i)
                if (!drag) w.set({ custom: { ...cw, past: [...cw.past.slice(-30), cw.points], future: [] } })
              }}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                e.preventDefault()
                const pts = cw.points.slice()
                pts[i] = Math.max(-1, Math.min(1, Math.round((p + (e.key === 'ArrowUp' ? 0.05 : -0.05)) * 100) / 100))
                edit(pts)
              }}
            />
          )
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <LabeledInput label="Formula (TypeScript)" mono value={cw.formula} onChange={(e) => w.set({ custom: { ...cw, formula: e.target.value } })} />
        <UnitInput label="Samples" value={cw.n} integer min={2} max={32768} onCommit={(v) => w.set({ custom: { ...cw, n: v } })} />
        <LabeledSelect label="Play Rate" value={cw.rate} onValueChange={(v) => w.set({ custom: { ...cw, rate: v } })} options={['Use Frequency', '48 kHz', '1 MHz']} />
      </div>
    </Material>
  )
}

export function Wavegen() {
  const w = useWavegen()
  const app = useStore()
  const n = w.ch.filter((c) => c.run).length
  const live = n > 0 && app.running && !!app.device
  const showSweep = w.tab === 'Sweep' || w.tab === 'Advanced'
  const showAdv = w.tab === 'Advanced'
  const showCustom = w.tab === 'Custom' || w.tab === 'Advanced' || w.tab === 'Play'
  const bar = (
    <PageBar title="Waveform Generator" status={<StatusDot state={live ? 'READY' : 'QUEUED'} label={live ? `${n} ${n === 1 ? 'Channel' : 'Channels'} Running` : 'Stopped'} />}>
      <Switch aria-label="Synchronization" value={w.sync} onChange={(v) => w.set({ sync: v })} options={['Independent', 'Synchronized', 'Auto Sync'] as const} />
      <Button
        size="small"
        type={n ? 'secondary' : 'primary'}
        prefix={n ? <Square size={16} /> : <Play size={16} />}
        onClick={() => {
          const run = n === 0
          w.set({ ch: [{ ...w.ch[0], run, out: run || w.ch[0].out }, { ...w.ch[1], run, out: run || w.ch[1].out }] })
          app.toast(run ? 'Both channels running' : 'Both channels stopped')
        }}
      >
        {n ? 'Stop All' : 'Run All'}
      </Button>
    </PageBar>
  )
  return (
    <ScrollPage bar={bar} className="flex min-w-0 flex-col gap-4">
      <Tabs tabs={TABS.map((t) => ({ title: t, value: t }))} selected={w.tab} setSelected={(v) => w.set({ tab: v as WG['tab'] })} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(440px,1fr))] gap-4">
        <Channel i={0} />
        <Channel i={1} />
      </div>
      {(showSweep || showAdv || showCustom) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(440px,1fr))] gap-4">
          {showSweep && (
            <Material className="flex min-w-0 flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="m-0 text-sm font-semibold leading-5 tracking-[-0.28px]">Sweep and Damp</h2>
                <Toggle checked={w.sweep.on} onChange={(on) => { w.set({ sweep: { ...w.sweep, on } }); app.toast(on ? `Sweep enabled: ${w.sweep.start} Hz to ${w.sweep.stop / 1000} kHz in ${w.sweep.time} s` : 'Sweep disabled') }}>
                  Enabled
                </Toggle>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(max(104px,calc(33.333%-12px)),1fr))] gap-3">
                <UnitInput label="Start Frequency" value={w.sweep.start} suffix="Hz" min={0.001} onCommit={(v) => w.set({ sweep: { ...w.sweep, start: v } })} />
                <UnitInput label="Stop Frequency" value={w.sweep.stop} scale={1000} suffix="kHz" min={0.001} onCommit={(v) => w.set({ sweep: { ...w.sweep, stop: v } })} />
                <UnitInput label="Sweep Time" value={w.sweep.time} suffix="s" min={0.001} onCommit={(v) => w.set({ sweep: { ...w.sweep, time: v } })} />
                <LabeledSelect label="Scale" value={w.sweep.scale} onValueChange={(v) => w.set({ sweep: { ...w.sweep, scale: v } })} options={['Linear', 'Logarithmic']} />
                <UnitInput label="Damp Start" value={w.sweep.dampStart} suffix="%" min={0} max={100} onCommit={(v) => w.set({ sweep: { ...w.sweep, dampStart: v } })} />
                <UnitInput label="Damp Stop" value={w.sweep.dampStop} suffix="%" min={0} max={100} onCommit={(v) => w.set({ sweep: { ...w.sweep, dampStop: v } })} />
              </div>
            </Material>
          )}
          {showAdv && (
            <Material className="flex min-w-0 flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="m-0 text-sm font-semibold leading-5 tracking-[-0.28px]">Modulation · Advanced</h2>
                <Switch aria-label="Modulation" value={w.mod.kind} onChange={(kind) => w.set({ mod: { ...w.mod, kind } })} options={['Off', 'AM', 'FM'] as const} />
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(max(104px,calc(33.333%-12px)),1fr))] gap-3">
                <LabeledSelect label="Carrier" value={w.mod.carrier} onValueChange={(v) => w.set({ mod: { ...w.mod, carrier: v } })} options={['Channel 1', 'Channel 2']} disabled={w.mod.kind === 'Off'} />
                <LabeledSelect label="Modulator Type" value={w.mod.type} onValueChange={(v) => w.set({ mod: { ...w.mod, type: v } })} options={['Sine', 'Square', 'Triangle', 'Custom']} disabled={w.mod.kind === 'Off'} />
                <UnitInput label="Modulator Frequency" value={w.mod.freq} suffix="Hz" min={0.001} onCommit={(v) => w.set({ mod: { ...w.mod, freq: v } })} disabled={w.mod.kind === 'Off'} />
                <UnitInput label="Index" value={w.mod.index} suffix="%" min={0} max={100} onCommit={(v) => w.set({ mod: { ...w.mod, index: v } })} disabled={w.mod.kind === 'Off'} />
                <UnitInput label="Modulator Offset" value={w.mod.offset} suffix="%" min={-100} max={100} onCommit={(v) => w.set({ mod: { ...w.mod, offset: v } })} disabled={w.mod.kind === 'Off'} />
                <UnitInput label="Phase" value={w.mod.phase} suffix="°" min={-360} max={360} onCommit={(v) => w.set({ mod: { ...w.mod, phase: v } })} disabled={w.mod.kind === 'Off'} />
              </div>
            </Material>
          )}
          {showCustom && <CustomEditor />}
        </div>
      )}
      <Note type="secondary" size="small">
        Supply mode and current limitation are available on Electronics Explorer only.
      </Note>
    </ScrollPage>
  )
}

// Real hardware follows the generator settings, and stops when instruments stop.
for (const i of [0, 1] as const) {
  follow(
    [useWavegen],
    () => {
      const c = useWavegen.getState().ch[i]
      return { c: { run: c.run, out: c.out, type: c.type, freq: c.freq, amp: c.amp, offset: c.offset, sym: c.sym, phase: c.phase }, on: useStore.getState().running }
    },
    ({ c, on }) => pushWave(i, c, on),
    `Wavegen Channel ${i + 1}`
  )
}
