// Oscilloscope (board: Main). Live captures from the simulated front end, a 10-division plot with
// cursors and a probe, measurements with running statistics, and the channel settings panel.
import {
  Button, DotsMenu, Entity, FormModal, LegendItem, Material, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger, Note, Select,
  Slider, StatusDot, Switch, Table, Tabs, Textarea, Toggle, type FormField
} from '@robcholz/geist'
import {
  Binary, ChevronDown, ChevronLeft, ChevronRight, Copy, Crosshair, Download, FileCode, Maximize2, Pencil, Play, Plus, RefreshCw,
  Ruler, ScrollText, Sigma, Square, StepForward, Trash2, Upload, Volume2, VolumeX, WandSparkles, ZoomIn, ZoomOut
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fixed, si } from '../components/format'
import { Grid2, LabeledSelect, PageBar, PanelSection, SplitPage } from '../components/Page'
import { Cursor } from '../components/Cursor'
import { Plot, type Series } from '../components/Plot'
import { UnitInput } from '../components/UnitInput'
import { histogram, spectrum } from '../sim/dsp'
import { check } from '../sim/expr'
import { capture, fromSamples, measure, reference, stats as recordStats, type Capture, type Stats } from '../sim/scope'
import { hw, useHardware } from '../devices'
import { useStore } from '../store'
import { openTable, publish, saveImage, saveTable, type Table as DataTable } from '../files'
import { toggleLoggingFor, useLoggingOf } from '../logging'
import { useScope, type ChannelId } from './scope-store'

/** Listen: loops the latest capture of one channel through the speakers, at its sample rate. */
let audio: { ctx: AudioContext; gain: GainNode; src: AudioBufferSourceNode | null } | null = null
function play(v: ArrayLike<number>, rate: number, fullScale: number, vol: number): void {
  // Browsers play 3 kS/s to 768 kS/s; other rates are resampled to the nearest end.
  const out = Math.min(768000, Math.max(3000, rate))
  const n = Math.max(1, Math.round((v.length * out) / rate))
  audio ??= (() => {
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    return { ctx, gain, src: null }
  })()
  const buf = audio.ctx.createBuffer(1, n, out)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.max(-1, Math.min(1, v[Math.min(v.length - 1, Math.floor((i * rate) / out))] / fullScale))
  audio.gain.gain.value = vol / 100
  const src = audio.ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  src.connect(audio.gain)
  src.start()
  audio.src?.stop()
  audio.src = src
}
function silence(): void {
  audio?.src?.stop()
  if (audio) audio.src = null
}

/** Sample Mode → the SDK's filter. */
const FILTER: Record<string, number> = { Decimate: 0, Average: 1, 'Min/Max': 2 }

/** R1: a stored trace, kept while the app runs. */
interface Ref {
  t: Float64Array
  v: Float64Array
  label: string
}
let savedRef: Ref | null = null

/** The reference resampled onto the shown time axis (zero outside it). */
function onAxis(r: Ref, t: Float64Array): Float64Array {
  const out = new Float64Array(t.length)
  let j = 0
  for (let i = 0; i < t.length; i++) {
    while (j < r.t.length - 2 && r.t[j + 1] < t[i]) j++
    const a = r.t[j]
    const b = r.t[j + 1] ?? a
    if (t[i] < r.t[0] || t[i] > r.t[r.t.length - 1]) continue
    const k = b === a ? 0 : (t[i] - a) / (b - a)
    out[i] = r.v[j] + ((r.v[j + 1] ?? r.v[j]) - r.v[j]) * Math.min(1, Math.max(0, k))
  }
  return out
}

const COLOR: Record<ChannelId, string> = { C1: 'var(--wf-c1)', C2: 'var(--wf-c2)', M1: 'var(--wf-c3)', R1: 'var(--gray-700)' }
const TABS = ['Time', 'XY', 'FFT', 'Histogram', 'Persistence', 'Data', 'Notes'] as const
const MEASURES = ['Frequency', 'Period', 'Peak to Peak', 'Amplitude', 'AC RMS', 'DC RMS', 'Average', 'Maximum', 'Minimum', 'Rise Time', 'Fall Time', 'Positive Duty', 'Negative Duty', 'Positive Width', 'Overshoot'] as const

function pick(st: Stats, m: string): { v: number; fmt: (v: number) => string } {
  const V = (v: number): string => fixed(v, 'V', 3)
  const pct = (v: number): string => (v * 100).toFixed(1) + '%'
  switch (m) {
    case 'Frequency': return { v: st.frequency, fmt: (v) => si(v, 'Hz', 4) }
    case 'Period': return { v: st.period, fmt: (v) => si(v, 's', 4) }
    case 'Peak to Peak': return { v: st.vpp, fmt: V }
    case 'Amplitude': return { v: st.amplitude, fmt: V }
    case 'AC RMS': return { v: st.acRms, fmt: V }
    case 'DC RMS': return { v: st.rms, fmt: V }
    case 'Average': return { v: st.mean, fmt: V }
    case 'Maximum': return { v: st.max, fmt: V }
    case 'Minimum': return { v: st.min, fmt: V }
    case 'Rise Time': return { v: st.rise, fmt: (v) => si(v, 's', 2) }
    case 'Fall Time': return { v: st.fall, fmt: (v) => si(v, 's', 2) }
    case 'Positive Duty': return { v: st.dutyPos, fmt: pct }
    case 'Negative Duty': return { v: 1 - st.dutyPos, fmt: pct }
    case 'Positive Width': return { v: st.widthPos, fmt: (v) => si(v, 's', 4) }
    default: return { v: st.overshoot, fmt: pct }
  }
}

interface Acc {
  min: number
  max: number
  sum: number
  n: number
  last: number
}

type Dialog = { title: string; description?: string; fields: FormField[]; submitLabel: string; columns?: 1 | 2; onSubmit: (v: Record<string, string>) => void } | null

export function Scope() {
  const s = useScope()
  const app = useStore()
  const cfg = s.cfg
  const live = s.running && app.running && !!app.device
  const [tab, setTab] = useState<(typeof TABS)[number]>('Time')
  const [cap, setCap] = useState<Capture>(() => capture(cfg))
  const [history, setHistory] = useState<Capture[]>([])
  const [capIndex, setCapIndex] = useState(0)
  const [armed, setArmed] = useState(false)
  const logging = useLoggingOf('Oscilloscope')
  const [ref, setRefState] = useState<Ref | null>(savedRef)
  const setRef = (r: Ref | null) => {
    savedRef = r
    setRefState(r)
  }
  const [dialog, setDialog] = useState<Dialog>(null)
  const stats = useRef<Record<string, Acc>>({})
  const [, bump] = useState(0)

  // Visible window, zoomed around the trigger position.
  const view = useMemo(() => ({ ...cfg, base: cfg.base / s.zoom }), [cfg, s.zoom])

  const real = useHardware()
  const inflight = useRef(false)
  // A real device: one capture of both channels across the visible window, at the record length set.
  const acquireHardware = async (): Promise<Capture | null> => {
    if (!hw || inflight.current) return null
    inflight.current = true
    try {
      const span = view.base * 10
      const n = Math.max(16, Math.min(32768, s.samples))
      const chans = (['C1', 'C2'] as const).map((c, i) => (cfg.ch[c].on ? i : -1)).filter((i) => i >= 0)
      if (!chans.length) return null
      const src = cfg.triggerSource === 'Channel 2' ? 1 : 0
      const r = await hw.scope({
        channels: chans,
        rate: n / span,
        samples: n,
        // A 10x probe divides the signal by 10 before the input: range and offset at the input, volts at the tip.
        range: { 0: (cfg.ch.C1.range * 10) / cfg.ch.C1.probe, 1: (cfg.ch.C2.range * 10) / cfg.ch.C2.probe },
        offset: { 0: -cfg.ch.C1.offset / cfg.ch.C1.probe, 1: -cfg.ch.C2.offset / cfg.ch.C2.probe },
        filter: { 0: FILTER[s.sampleMode.C1] ?? 1, 1: FILTER[s.sampleMode.C2] ?? 1 },
        trigger:
          cfg.triggerMode === 'None'
            ? undefined
            : {
                channel: src,
                level: cfg.level / cfg.ch[src ? 'C2' : 'C1'].probe,
                slope: cfg.condition === 'Falling' ? 'Fall' : cfg.condition === 'Either' ? 'Either' : 'Rise',
                position: cfg.position,
                autoTimeout: cfg.triggerMode === 'Auto' ? 0.25 : 0,
                // TRIGSRC numbers from dwf.h; the channels use the scope's own detector.
                source: { 'External 1': 11, 'External 2': 12, 'Wavegen 1': 7, Logic: 5 }[cfg.triggerSource],
                type: s.triggerType === 'Pulse' ? 1 : s.triggerType === 'Transition' ? 2 : 0,
                holdoff: Number(s.holdoff) || 0,
                hysteresis: s.hysteresis === 'Auto' ? undefined : Number(s.hysteresis) / cfg.ch[src ? 'C2' : 'C1'].probe,
                filter: FILTER[s.filter],
                lengthCondition: s.lengthCond === 'Timeout' ? 1 : s.lengthCond === 'More' ? 2 : 0,
                length: Number(s.length) * 1e-6
              }
      })
      const pick = (i: number): Float64Array | null => {
        const v = chans.includes(i) ? r.data[chans.indexOf(i)] : null
        const k = cfg.ch[i ? 'C2' : 'C1'].probe
        if (v && k !== 1) for (let j = 0; j < v.length; j++) v[j] *= k
        // AC coupling on devices without a coupling switch: the mean of the capture is removed.
        if (v && cfg.ch[i ? 'C2' : 'C1'].coupling === 'AC') {
          const m = v.reduce((a, b) => a + b, 0) / v.length
          for (let k = 0; k < v.length; k++) v[k] -= m
        }
        return v
      }
      return fromSamples(cfg, r.rate, pick(0), pick(1))
    } catch (e) {
      s.set({ running: false })
      toast('Capture failed', { detail: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      return null
    } finally {
      inflight.current = false
    }
  }

  const acquire = (): void => {
    if (real) {
      void acquireHardware().then((c) => c && record(c, (ch) => recordStats(c.t, c[ch])))
      return
    }
    record(capture(view), (ch) => measure(ch, cfg))
  }
  const record = (c: Capture, measureCh: (ch: 'C1' | 'C2' | 'M1') => Stats): void => {
    for (const ch of ['C1', 'C2'] as const) {
      const z = s.zero?.[ch] ?? 0
      if (z) for (let i = 0; i < c[ch].length; i++) c[ch][i] -= z
    }
    setCap(c)
    publish('Oscilloscope', {
      columns: ['Time (s)', `${s.names.C1} (V)`, `${s.names.C2} (V)`, ...(s.show.M1 ? ['M1'] : [])],
      data: [c.t, c.C1, c.C2, ...(s.show.M1 ? [c.M1] : [])],
      triggered: c.triggered,
      meta: { 'Time Base': `${si(cfg.base, 's')}/div`, Trigger: `${cfg.triggerSource} ${cfg.condition} ${cfg.level} V`, Rate: si(c.t.length > 1 ? 1 / (c.t[1] - c.t[0]) : 0, 'S/s') }
    })
    setHistory((h) => [...h.slice(-(s.history - 1)), c])
    setCapIndex(0)
    for (const m of s.measurements) {
      if (m.ch === 'R1') continue
      const st = measureCh(m.ch as 'C1' | 'C2' | 'M1')
      const v = pick(st, m.m).v
      const k = m.ch + m.m
      const a = stats.current[k] ?? { min: Infinity, max: -Infinity, sum: 0, n: 0, last: v }
      stats.current[k] = { min: Math.min(a.min, v), max: Math.max(a.max, v), sum: a.sum + v, n: a.n + 1, last: v }
    }
    bump((x) => x + 1)
  }

  // Run: capture every update interval. Settings changes re-capture immediately, even when stopped.
  useEffect(() => {
    if (!live) return
    acquire()
    const t = setInterval(acquire, Math.max(30, s.updateMs))
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, s.updateMs, view, s.measurements])
  useEffect(() => {
    if (!live && !real) setCap(capture(view, 2000, 0.13))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  useEffect(() => {
    if (!s.audio.on) return silence()
    const ch = s.audio.src === 'Channel 2' ? 'C2' : s.audio.src === 'M1' ? 'M1' : 'C1'
    const t = cap.t
    if (t.length < 2) return
    const range = cfg.ch[ch === 'C2' ? 'C2' : 'C1'].range * 5
    play(cap[ch], 1 / (t[1] - t[0]), range, s.audio.vol)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cap, s.audio.on, s.audio.src, s.audio.vol])
  useEffect(() => () => silence(), [])

  const shown = capIndex > 0 && history.length ? history[history.length - capIndex] ?? cap : cap
  const r1 = useMemo(() => (ref ? onAxis(ref, shown.t) : real ? new Float64Array(shown.t.length) : reference(shown.t)), [shown.t, ref, real])
  const mathError = check(cfg.math, ['C1', 'C2', 'R1'])

  const toast = app.toast
  const toggleRun = (): void => {
    if (!app.device) return toast('No device connected', { detail: 'Connect one in Device Manager.' })
    if (!app.running) app.setRunning(true)
    s.set({ running: !s.running })
    setArmed(false)
    toast(s.running ? 'Oscilloscope stopped' : 'Oscilloscope running')
  }
  const single = (): void => {
    s.set({ running: false })
    setArmed(true)
    setTimeout(() => {
      acquire()
      setArmed(false)
      toast('Single capture acquired')
    }, 400)
  }
  const autoSet = (): void => {
    s.setCfg({ base: 200e-6, position: 0, level: 0, triggerSource: 'Channel 1', ch: { C1: { ...cfg.ch.C1, range: 1, offset: 0 }, C2: { ...cfg.ch.C2, range: 1, offset: -3 } } })
    s.set({ zoom: 1 })
    toast('Auto Set: 1 V/div, 200 µs/div, trigger at 0 V')
  }
  const resetStats = (): void => {
    stats.current = {}
    bump((x) => x + 1)
    toast('Statistics reset')
  }

  // Channel traces in screen volts: (v + offset) / range gives divisions; the plot spans ±5 div.
  const scaled = (v: ArrayLike<number>, ch: 'C1' | 'C2'): Float64Array => {
    const c = cfg.ch[ch]
    return Float64Array.from(v as ArrayLike<number>, (x) => (x + c.offset) / c.range)
  }
  const series: Series[] = [
    { id: 'R1', name: 'R1', color: COLOR.R1, x: shown.t, y: scaled(r1, 'C1'), hidden: !s.show.R1, dashed: true, width: 1.25, unit: 'div' },
    { id: 'M1', name: 'M1', color: COLOR.M1, x: shown.t, y: scaled(shown.M1, 'C1'), hidden: !s.show.M1 || !!mathError, width: 1.25, unit: 'div' },
    { id: 'C2', name: s.names.C2 === 'Channel 2' ? 'C2' : s.names.C2, color: COLOR.C2, x: shown.t, y: scaled(shown.C2, 'C2'), hidden: !s.show.C2 || !cfg.ch.C2.on, unit: 'div' },
    { id: 'C1', name: s.names.C1 === 'Channel 1' ? 'C1' : s.names.C1, color: COLOR.C1, x: shown.t, y: scaled(shown.C1, 'C1'), hidden: !s.show.C1 || !cfg.ch.C1.on, unit: 'div' }
  ]
  // Probe readouts in volts rather than divisions.
  const probeSeries = series.map((x) => {
    const ch = x.id === 'C2' ? 'C2' : 'C1'
    const c = cfg.ch[ch]
    return { ...x, y: Float64Array.from(x.y as Float64Array, (d) => d * c.range - c.offset), unit: 'V' }
  })

  const span = view.base * 10
  const xAxis = { min: view.position - span / 2, max: view.position + span / 2, unit: 's', label: 't' }
  const yAxis = { min: -5, max: 5, unit: 'V', format: (d: number) => (Math.abs(d) < 1e-9 ? '0 V' : (d * cfg.ch.C1.range - cfg.ch.C1.offset).toFixed(Math.abs(d) === 5 ? 0 : 0) + (Math.abs(d) === 5 ? ' V' : '')) }

  const valueAt = (arr: Float64Array, t: number): number => {
    const i = Math.round(((t - shown.t[0]) / (shown.t[shown.t.length - 1] - shown.t[0])) * (shown.t.length - 1))
    return arr[Math.max(0, Math.min(arr.length - 1, i))]
  }
  const cursorRows = s.cursors.map((x, i) => {
    const prev = i > 0 ? s.cursors[0] : null
    const d = prev == null ? null : x - prev
    return {
      c: 'X' + (i + 1),
      x: si(x, 's', 4),
      d: d == null ? '' : si(d, 's', 4),
      f: d ? si(1 / Math.abs(d), 'Hz', 4) : '',
      v1: fixed(valueAt(shown.C1, x), 'V'),
      v2: fixed(valueAt(shown.C2, x), 'V')
    }
  })

  const measRows = s.measurements.map((m) => {
    const a = stats.current[m.ch + m.m]
    const unitFmt = pick(measure('C1', cfg), m.m).fmt
    if (m.ch === 'R1') return { id: m.id, ch: m.ch, m: m.m, v: '—', mn: '—', av: '—', mx: '—', n: '—' }
    if (!a) return { id: m.id, ch: m.ch, m: m.m, v: '—', mn: '—', av: '—', mx: '—', n: '0' }
    return { id: m.id, ch: m.ch, m: m.m, v: unitFmt(a.last), mn: unitFmt(a.min), av: unitFmt(a.sum / a.n), mx: unitFmt(a.max), n: a.n.toLocaleString() }
  })

  const ask = (d: NonNullable<Dialog>): void => setDialog(d)
  const table = (): DataTable => ({
    columns: ['Time (s)', `${s.names.C1} (V)`, `${s.names.C2} (V)`, ...(s.show.M1 ? ['M1'] : [])],
    data: [shown.t, shown.C1, shown.C2, ...(s.show.M1 ? [shown.M1] : [])],
    at: Date.now(),
    triggered: shown.triggered
  })
  const exportData = (c?: 'C1' | 'C2'): void => void saveTable(c ? `${s.names[c].toLowerCase().replace(/\s+/g, '-')}.csv` : 'scope.csv', table(), { only: c ? [`${s.names[c]} (V)`] : undefined, comments: { 'Time Base': `${si(cfg.base, 's')}/div` } })
  const toggleLog = (): void => toggleLoggingFor('Oscilloscope')
  const snapshot = (c: 'C1' | 'C2'): void => {
    setRef({ t: shown.t.slice(), v: shown[c].slice(), label: `Snapshot of ${s.names[c]} at ${new Date().toLocaleTimeString()}` })
    s.set({ show: { ...s.show, R1: true } })
    toast(`R1 updated from ${s.names[c]}`)
  }
  const importRef = async (): Promise<void> => {
    const f = await openTable()
    if (!f) return
    const col = f.data.length > 1 ? 1 : 0
    const v = Float64Array.from(f.data[col])
    const t = f.data.length > 1 ? Float64Array.from(f.data[0]) : Float64Array.from(v, (_, i) => (i - v.length / 2) * (shown.t[1] - shown.t[0]))
    setRef({ t, v, label: `${f.name}, ${f.columns[col]}` })
    s.set({ show: { ...s.show, R1: true } })
    toast(`Imported ${f.name} into R1`, { detail: `${v.length.toLocaleString()} samples from ${f.columns[col]}. The first column is time in seconds.` })
  }

  const status = !app.device ? (
    <StatusDot state="ERROR" label="No Device" />
  ) : armed ? (
    <StatusDot state="BUILDING" label="Armed" />
  ) : live ? (
    <StatusDot state={cap.triggered ? 'READY' : 'BUILDING'} label={cap.triggered ? 'Triggered' : 'Auto'} />
  ) : (
    <StatusDot state="CANCELED" label="Stopped" />
  )

  const bar = (
    <PageBar title="Oscilloscope" status={status}>
      <Switch aria-label="Trigger Mode" value={cfg.triggerMode} onChange={(v) => s.setCfg({ triggerMode: v })} options={['Auto', 'Normal', 'None'] as const} />
      <Select size="small" aria-label="Run Mode" value={s.runMode} onValueChange={(v) => s.set({ runMode: v })} options={['Repeated', 'Scan Screen', 'Scan Shift', 'Record']} className="!w-[148px]" />
      <Button type="secondary" size="small" prefix={<WandSparkles size={16} />} onClick={autoSet}>
        Auto Set
      </Button>
      <Button type="secondary" size="small" prefix={<StepForward size={16} />} onClick={single}>
        Single
      </Button>
      <Button size="small" prefix={s.running && app.running ? <Square size={16} /> : <Play size={16} />} onClick={toggleRun} tooltipKeys={['Space']}>
        {s.running && app.running ? 'Stop' : 'Run'}
      </Button>
    </PageBar>
  )

  const chips = (['C1', 'C2', 'M1', 'R1'] as const).map((c) => (
    <LegendItem
      key={c}
      size="medium"
      color={COLOR[c]}
      label={c}
      detail={c === 'C2' ? `${cfg.ch.C2.range} V/div` : `${cfg.ch.C1.range} V/div`}
      pressed={s.show[c]}
      onToggle={(on) => s.set({ show: { ...s.show, [c]: on } })}
    />
  ))

  const overlay = (toPct: (x: number, y: number) => { left: string; top: string }) => (
    <>
      {/* Channel ground markers and the trigger position and level. */}
      {(['C1', 'C2'] as const).map((c) =>
        cfg.ch[c].on && s.show[c] ? (
          <span
            key={c}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 h-4 -translate-y-1/2 rounded-r-[4px] px-1 text-[11px] font-semibold leading-4 text-background-100"
            style={{ top: (0.5 - cfg.ch[c].offset / cfg.ch[c].range / 10) * 100 + '%', background: COLOR[c] }}
          >
            {c[1]}
          </span>
        ) : null
      )}
      <span aria-hidden="true" className="pointer-events-none absolute top-0 size-0 -translate-x-1/2 border-x-[6px] border-t-8 border-x-transparent border-t-gray-1000" style={{ left: toPct(cfg.position, 0).left }} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 size-0 -translate-y-1/2 border-y-[6px] border-r-8 border-y-transparent"
        style={{
          top: (0.5 - (cfg.level + cfg.ch[cfg.triggerSource === 'Channel 2' ? 'C2' : 'C1'].offset) / cfg.ch[cfg.triggerSource === 'Channel 2' ? 'C2' : 'C1'].range / 10) * 100 + '%',
          borderRightColor: COLOR[cfg.triggerSource === 'Channel 2' ? 'C2' : 'C1']
        }}
      />
      {s.cursors.map((x, i) => (
        <Cursor key={i} label={'X' + (i + 1)} left={toPct(x, 0).left} onMove={(fx) => {
          const t = xAxis.min + fx * (xAxis.max - xAxis.min)
          const next = s.cursors.slice()
          next[i] = t
          s.set({ cursors: next })
        }} />
      ))}
      {s.plotLabels.map((l, i) => (
        <span key={i} className="absolute z-[2] h-[22px] rounded-small bg-background-100 px-2 text-xs leading-[22px] shadow-[0_0_0_1px_var(--gray-alpha-600)]" style={{ left: toPct(l.x, 0).left, bottom: 16 + (i % 3) * 28 }}>
          {l.text}
        </span>
      ))}
    </>
  )

  const plot = (() => {
    if (tab === 'Time')
      return (
        <>
          <Plot x={xAxis} y={yAxis} series={probeSeries.map((p, i) => ({ ...p, y: series[i].y }))} ariaLabel="Channel traces" overlay={overlay} onView={(a, b) => { s.set({ zoom: Math.min(1000, Math.max(1, (cfg.base * 10) / (b - a))) }); s.setCfg({ position: (a + b) / 2 }) }} />
          {s.show.digital && !real && <Digital t={shown.t} />}
        </>
      )
    if (tab === 'XY')
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <LegendItem color={COLOR.C1} label="C1 (X) versus C2 (Y)" />
          </div>
          <Plot
            x={{ min: -2.5, max: 2.5, unit: 'V', label: 'C1' }}
            y={{ min: -0.5, max: 4.5, unit: 'V', label: 'C2' }}
            series={[{ id: 'xy', name: 'C1 vs C2', color: COLOR.C1, x: shown.C1, y: shown.C2 }]}
            probe="nearest"
            ariaLabel="XY plot of channel 1 against channel 2"
          />
        </>
      )
    if (tab === 'FFT') {
      const fine = capture({ ...cfg, base: 1e-3, position: 5e-3 }, 8192)
      const fs = 8192 / 10e-3
      const a = spectrum(fine.C1, fs)
      const b = spectrum(fine.C2, fs)
      const lim = a.f.findIndex((f) => f > 20000)
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <LegendItem color={COLOR.C1} label="C1 sine" />
            <LegendItem color={COLOR.C2} label="C2 square, odd harmonics" />
          </div>
          <Plot
            x={{ min: 0, max: 20000, unit: 'Hz', label: 'f', divisions: 4 }}
            y={{ min: -100, max: 10, unit: 'dBV', divisions: 4, format: (v) => (v === 10 || v === -100 ? v + ' dBV' : String(v)) }}
            series={[
              { id: 'C2', name: 'C2', color: COLOR.C2, x: b.f.subarray(0, lim), y: b.db.subarray(0, lim), unit: 'dBV', width: 1.25 },
              { id: 'C1', name: 'C1', color: COLOR.C1, x: a.f.subarray(0, lim), y: a.db.subarray(0, lim), unit: 'dBV', width: 1.25 }
            ]}
            ariaLabel="FFT of both channels"
          />
        </>
      )
    }
    if (tab === 'Histogram') {
      const h = histogram(shown.C1, -2.5, 2.5, 40)
      const max = Math.max(...h.count)
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <LegendItem color={COLOR.C1} marker label="C1 voltage distribution" />
          </div>
          <Plot
            x={{ min: -2.5, max: 2.5, unit: 'V', label: 'C1', divisions: 4 }}
            y={{ min: 0, max: Math.ceil(max / 50) * 50 || 50, unit: '', divisions: 4, format: (v) => String(Math.round(v)) }}
            series={[{ id: 'h', name: 'Count', color: COLOR.C1, x: h.x, y: h.count, kind: 'bars', unit: '' }]}
            ariaLabel="Histogram of channel 1 samples"
          />
        </>
      )
    }
    if (tab === 'Persistence') {
      const old = history.slice(-12)
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <LegendItem color={COLOR.C1} label={`C1, last ${old.length} captures`} />
          </div>
          <Plot
            x={xAxis}
            y={yAxis}
            probe="none"
            series={old.map((c, i) => ({ id: 'p' + i, name: 'C1', color: COLOR.C1, x: c.t, y: scaled(c.C1, 'C1'), opacity: 0.12 + (0.6 * i) / Math.max(1, old.length), width: 1 }))}
            ariaLabel="Persistence view of channel 1"
          />
        </>
      )
    }
    if (tab === 'Data') {
      const rows = Array.from({ length: 40 }, (_, i) => {
        const k = Math.floor((i / 40) * shown.t.length)
        return { i: k, t: si(shown.t[k], 's', 4), c1: fixed(shown.C1[k], 'V'), c2: fixed(shown.C2[k], 'V') }
      })
      return (
        <Table
          compact
          caption="Samples"
          columns={[
            { key: 'i', title: 'Sample', align: 'right' },
            { key: 't', title: 'Time', align: 'right' },
            { key: 'c1', title: 'C1', align: 'right', mono: true },
            { key: 'c2', title: 'C2', align: 'right', mono: true }
          ]}
          rows={rows}
        />
      )
    }
    return <Textarea aria-label="Notes" rows={14} placeholder="Notes for this capture, saved with the workspace" value={s.notes} onChange={(e) => s.set({ notes: e.target.value })} />
  })()

  const chMenu = (c: 'C1' | 'C2') => (
    <>
      <MenuItem prefix={<Pencil size={16} />} onSelect={() => ask({ title: 'Rename Channel', fields: [{ key: 'n', label: 'Name', value: s.names[c], required: true }], submitLabel: 'Rename', onSubmit: (v) => { s.set({ names: { ...s.names, [c]: v.n } }); toast(`${c} renamed to ${v.n}`) } })}>
        Rename Channel
      </MenuItem>
      <MenuItem prefix={<Copy size={16} />} onSelect={() => snapshot(c)}>
        Copy as Reference
      </MenuItem>
      <MenuItem prefix={<Download size={16} />} onSelect={() => exportData(c)}>
        Export Data
      </MenuItem>
      <MenuSeparator />
      <MenuItem prefix={<RefreshCw size={16} />} onSelect={() => { s.setCh(c, { offset: c === 'C2' ? -3 : 0, range: 1, coupling: 'DC' }); toast(`${s.names[c]} reset`) }}>
        Reset Channel
      </MenuItem>
    </>
  )

  const channelSection = (c: 'C1' | 'C2') => (
    <PanelSection
      key={c}
      title={
        <>
          <span aria-hidden="true" className="h-0.5 w-3" style={{ background: COLOR[c] }} />
          {s.names[c]}
        </>
      }
      actions={
        <>
          <Toggle checked={cfg.ch[c].on} onChange={(on) => s.setCh(c, { on })} aria-label={`Enable ${s.names[c]}`} />
          <DotsMenu aria-label={`${s.names[c]} Actions`} menu={chMenu(c)} />
        </>
      }
    >
      <Grid2>
        <UnitInput label="Offset" value={cfg.ch[c].offset} suffix="V" min={-25} max={25} onCommit={(v) => s.setCh(c, { offset: v })} />
        <UnitInput label="Range" value={cfg.ch[c].range} suffix="V/div" min={0.0005} max={10} onCommit={(v) => s.setCh(c, { range: v })} />
        <LabeledSelect label="Probe" value={`${cfg.ch[c].probe}x`} onValueChange={(v) => s.setCh(c, { probe: parseFloat(v) })} options={['1x', '10x', '100x']} />
        <LabeledSelect label="Sample Mode" value={s.sampleMode[c]} onValueChange={(v) => s.set({ sampleMode: { ...s.sampleMode, [c]: v } })} options={['Average', 'Decimate', 'Min/Max']} />
        <LabeledSelect label="Coupling" value={cfg.ch[c].coupling} onValueChange={(v) => s.setCh(c, { coupling: v as 'DC' | 'AC' })} options={['DC', 'AC']} />
      </Grid2>
      <Button
        type="tertiary"
        size="small"
        prefix={<Ruler size={16} />}
        className="self-start"
        onClick={() => {
          const zero = s.zero ?? { C1: 0, C2: 0 }
          if (zero[c]) {
            s.set({ zero: { ...zero, [c]: 0 } })
            return toast(`Zero offset cleared on ${s.names[c]}`)
          }
          // The input should be grounded: its mean now is the offset to remove.
          const v = shown[c]
          const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)
          s.set({ zero: { ...zero, [c]: m } })
          toast(`Zero offset set on ${s.names[c]}`, { detail: `${si(m, 'V')} is subtracted from every capture. Ground the input before you press this.` })
        }}
      >
        {s.zero?.[c] ? `Clear Zero Offset (${si(s.zero[c], 'V')})` : 'Zero Offset'}
      </Button>
    </PanelSection>
  )

  const panel = (
    <>
      <PanelSection title="Time">
        <Grid2>
          <UnitInput label="Position" value={cfg.position} scale={1e-6} suffix="µs" onCommit={(v) => s.setCfg({ position: v })} />
          <UnitInput label="Base" value={cfg.base} scale={1e-6} suffix="µs/div" min={1e-8} max={1} onCommit={(v) => s.setCfg({ base: v })} />
          <UnitInput label="Samples" value={s.samples} integer min={16} max={32768} onCommit={(v) => s.set({ samples: v })} />
          <UnitInput label="Rate" value={s.rate} scale={1e6} suffix="MS/s" min={1} max={125e6} onCommit={(v) => s.set({ rate: v })} />
          <LabeledSelect label="Range Display" value={s.rangeDisplay} onValueChange={(v) => s.set({ rangeDisplay: v })} options={['Per Division', 'Plus Minus', 'Full Range']} />
          <UnitInput label="Update Interval" value={s.updateMs} suffix="ms" integer min={10} max={10000} onCommit={(v) => s.set({ updateMs: v })} />
          <UnitInput label="History" value={s.history} suffix="captures" integer min={1} max={1000} onCommit={(v) => s.set({ history: v })} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Trigger">
        <Grid2>
          <LabeledSelect label="Source" value={cfg.triggerSource} onValueChange={(v) => s.setCfg({ triggerSource: v })} options={['Channel 1', 'Channel 2', 'External 1', 'External 2', 'Wavegen 1', 'Logic']} />
          <LabeledSelect label="Type" value={s.triggerType} onValueChange={(v) => s.set({ triggerType: v })} options={['Edge', 'Pulse', 'Transition']} />
          <LabeledSelect label="Condition" value={cfg.condition} onValueChange={(v) => s.setCfg({ condition: v as 'Rising' })} options={['Rising', 'Falling', 'Either']} />
          <UnitInput label="Level" value={cfg.level} suffix="V" min={-25} max={25} onCommit={(v) => s.setCfg({ level: v })} />
          <UnitInput label="Hysteresis (0 = Auto)" value={s.hysteresis === 'Auto' ? 0 : Number(s.hysteresis) || 0} suffix="V" min={0} max={5} onCommit={(v) => s.set({ hysteresis: v ? String(v) : 'Auto' })} />
          <UnitInput label="Holdoff" value={Number(s.holdoff)} suffix="s" min={0} onCommit={(v) => s.set({ holdoff: String(v) })} />
          {s.triggerType !== 'Edge' && (
            <>
              <LabeledSelect label="Length Condition" value={s.lengthCond} onValueChange={(v) => s.set({ lengthCond: v })} options={['Less', 'Timeout', 'More']} />
              <UnitInput label="Length" value={Number(s.length)} suffix="µs" min={0} onCommit={(v) => s.set({ length: String(v) })} />
            </>
          )}
          <LabeledSelect label="Filter" value={s.filter} onValueChange={(v) => s.set({ filter: v })} options={['Decimate', 'Average', 'Min/Max']} />
          <UnitInput label="Auto Timeout" value={Number(s.autoTimeout)} suffix="ms" min={0} onCommit={(v) => s.set({ autoTimeout: String(v) })} />
        </Grid2>
        {!cap.triggered && cfg.triggerMode !== 'None' && app.device && (
          <Note type="warning" size="small">
            The level is outside the {cfg.triggerSource === 'Channel 2' ? 'C2' : 'C1'} signal, so captures aren’t triggered. Set it between the signal’s minimum and maximum.
          </Note>
        )}
      </PanelSection>
      {channelSection('C1')}
      {channelSection('C2')}
      <PanelSection title="Math, Reference and Digital">
        <Material>
          <Entity title="M1 · Math" description={mathError ? <span className="text-red-900">{mathError}</span> : <span className="font-mono">{cfg.math}</span>} icon={<Sigma size={16} />}>
            <Toggle checked={s.show.M1} onChange={(on) => s.set({ show: { ...s.show, M1: on } })} aria-label="Show M1" />
            <DotsMenu
              aria-label="M1 Actions"
              menu={
                <>
                  <MenuItem prefix={<Pencil size={16} />} onSelect={() => ask({ title: 'Edit Math Channel', fields: [{ key: 'f', label: 'Formula', value: cfg.math, required: true, mono: true, help: 'Use C1, C2, R1 and functions such as abs(), sqrt(), min(), max().', validate: (v) => check(v, ['C1', 'C2', 'R1']) }], submitLabel: 'Apply Formula', onSubmit: (v) => { s.setCfg({ math: v.f }); s.set({ show: { ...s.show, M1: true } }); toast('M1 formula updated') } })}>
                    Edit Formula
                  </MenuItem>
                  <MenuItem prefix={<FileCode size={16} />} onSelect={() => app.go('script')}>
                    Edit in TypeScript
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger prefix={<Trash2 size={16} />} onSelect={() => { s.set({ show: { ...s.show, M1: false } }); toast('M1 hidden') }}>
                    Remove
                  </MenuItem>
                </>
              }
            />
          </Entity>
          <Entity title="R1 · Reference" description={ref?.label ?? (real ? 'Empty. Copy a channel or import a CSV.' : 'Simulated snapshot of C1')} icon={<Copy size={16} />}>
            <Toggle checked={s.show.R1} onChange={(on) => s.set({ show: { ...s.show, R1: on } })} aria-label="Show R1" />
            <DotsMenu
              aria-label="R1 Actions"
              menu={
                <>
                  <MenuItem prefix={<RefreshCw size={16} />} onSelect={() => snapshot('C1')}>
                    Update Snapshot
                  </MenuItem>
                  <MenuItem prefix={<Upload size={16} />} onSelect={() => void importRef()}>
                    Import File
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger prefix={<Trash2 size={16} />} onSelect={() => { setRef(null); s.set({ show: { ...s.show, R1: false } }); toast('R1 removed') }}>
                    Remove
                  </MenuItem>
                </>
              }
            />
          </Entity>
          <Entity title="Digital · DIO 0–1" description="Mixed signal from Logic, shared trigger" icon={<Binary size={16} />} className="shadow-none">
            <Toggle checked={s.show.digital && !real} disabled={real} onChange={(on) => s.set({ show: { ...s.show, digital: on } })} aria-label="Show Digital" />
          </Entity>
        </Material>
      </PanelSection>
      <PanelSection
        title="Audio"
        actions={
          <Button type="secondary" size="small" prefix={s.audio.on ? <VolumeX size={16} /> : <Volume2 size={16} />} onClick={() => { s.set({ audio: { ...s.audio, on: !s.audio.on } }); toast(s.audio.on ? 'Audio stopped' : `Playing ${s.audio.src}`) }}>
            {s.audio.on ? 'Stop' : 'Listen'}
          </Button>
        }
      >
        <LabeledSelect label="Source" value={s.audio.src} onValueChange={(v) => s.set({ audio: { ...s.audio, src: v } })} options={['Channel 1', 'Channel 2', 'M1']} />
        <Slider label="Volume" value={s.audio.vol} valueLabel={s.audio.vol + '%'} onChange={(v) => s.set({ audio: { ...s.audio, vol: v } })} />
        <Note type="secondary" size="small">
          Plays the selected channel through your computer speakers, resampled to 48 kHz.
        </Note>
      </PanelSection>
    </>
  )

  return (
    <SplitPage bar={bar} panelId="scope" panel={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={TABS.map((t) => ({ title: t, value: t }))} selected={tab} setSelected={(v) => setTab(v as (typeof TABS)[number])} />
        <div className="flex items-center gap-2">
          <Button type="tertiary" size="small" svgOnly aria-label="Previous Capture" tooltip disabled={capIndex >= history.length} onClick={() => setCapIndex(capIndex + 1)}>
            <ChevronLeft size={16} />
          </Button>
          <span className="text-[13px] leading-4 tabular-nums text-gray-900">
            Capture {Math.max(1, history.length - capIndex)} of {Math.max(1, history.length)}
          </span>
          <Button type="tertiary" size="small" svgOnly aria-label="Next Capture" tooltip disabled={capIndex === 0} onClick={() => setCapIndex(capIndex - 1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
      {tab === 'Time' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {chips}
            <div className="flex">
              <Button type="secondary" size="small" prefix={<Plus size={16} />} className="rounded-r-none" onClick={() => { s.set({ show: { ...s.show, M1: true } }); toast('M1 shown') }}>
                Add Channel
              </Button>
              <MenuRoot>
                <MenuTrigger asChild>
                  <Button type="secondary" size="small" svgOnly aria-label="More Channel Types" className="ml-px rounded-l-none">
                    <ChevronDown size={16} />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem prefix={<Sigma size={16} />} onSelect={() => s.set({ show: { ...s.show, M1: true } })}>Math Channel</MenuItem>
                  <MenuItem prefix={<Copy size={16} />} onSelect={() => s.set({ show: { ...s.show, R1: true } })}>Reference Channel</MenuItem>
                  <MenuItem prefix={<Binary size={16} />} onSelect={() => { if (real) return toast('Digital channels are in the Logic Analyzer', { detail: 'This device captures them there, on their own time base.' }); s.set({ show: { ...s.show, digital: true } }); toast('Digital channels shown') }}>Digital Channels</MenuItem>
                  <MenuItem prefix={<Upload size={16} />} onSelect={() => void importRef()}>Import File…</MenuItem>
                </MenuContent>
              </MenuRoot>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button type="tertiary" size="small" svgOnly aria-label="Zoom In" tooltip disabled={s.zoom >= 16} onClick={() => s.set({ zoom: Math.min(16, s.zoom * 2) })}>
              <ZoomIn size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label="Zoom Out" tooltip disabled={s.zoom <= 1} onClick={() => s.set({ zoom: Math.max(1, s.zoom / 2) })}>
              <ZoomOut size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label="Show Entire Capture" tooltip disabled={s.zoom === 1} onClick={() => s.set({ zoom: 1 })}>
              <Maximize2 size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label={s.cursors.length >= 4 ? 'Remove Extra Cursors' : 'Add Cursor'} tooltip onClick={() => {
              if (s.cursors.length >= 4) {
                s.set({ cursors: s.cursors.slice(0, 2) })
                toast('Extra cursors removed')
              } else {
                s.set({ cursors: [...s.cursors, cfg.position + (s.cursors.length - 1.5) * view.base * 2] })
                toast(`Cursor X${s.cursors.length + 1} added`)
              }
            }}>
              <Crosshair size={16} />
            </Button>
            <Button type="tertiary" size="small" svgOnly aria-label="Add Label" tooltip onClick={() => ask({ title: 'Add Label', fields: [{ key: 't', label: 'Label Text', placeholder: 'Probe on TP4', required: true }], submitLabel: 'Add Label', onSubmit: (v) => s.set({ plotLabels: [...s.plotLabels, { text: v.t, x: cfg.position - view.base * 3 + s.plotLabels.length * view.base * 1.4 }] }) })}>
              <Pencil size={16} />
            </Button>
            <DotsMenu
              aria-label="Plot Actions"
              menu={
                <>
                  <MenuItem prefix={<Download size={16} />} onSelect={() => exportData()}>Export Data</MenuItem>
                  <MenuItem prefix={<Upload size={16} />} onSelect={() => void saveImage('scope.png')}>Export Image</MenuItem>
                  <MenuItem prefix={<ScrollText size={16} />} onSelect={toggleLog}>{logging ? 'Stop Logging' : 'Start Logging'}</MenuItem>
                  {s.plotLabels.length > 0 && <MenuItem prefix={<Trash2 size={16} />} onSelect={() => s.set({ plotLabels: [] })}>Clear Labels</MenuItem>}
                </>
              }
            />
          </div>
        </div>
      )}
      {plot}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] leading-4 tabular-nums text-gray-900">
          {s.samples.toLocaleString()} Samples · {si(s.rate, 'S/s', 4)} · {si(cfg.base * 10, 's')} · Update Every {s.updateMs} ms
        </span>
        <Button type="tertiary" size="small" prefix={logging ? <Square size={16} /> : <ScrollText size={16} />} onClick={toggleLog}>
          {logging ? 'Stop Logging' : 'Start Logging'}
        </Button>
      </div>
      {tab === 'Time' && (
        <Table
          compact
          caption="Cursors"
          columns={[
            { key: 'c', title: 'Cursor' },
            { key: 'x', title: 'Position', align: 'right' },
            { key: 'd', title: 'Delta', align: 'right' },
            { key: 'f', title: '1 / Delta', align: 'right' },
            { key: 'v1', title: 'C1', align: 'right' },
            { key: 'v2', title: 'C2', align: 'right' }
          ]}
          rows={cursorRows}
        />
      )}
      <div className="mt-1 flex items-center justify-between gap-2">
        <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">Measurements</h2>
        <div className="flex gap-2">
          <Button type="tertiary" size="small" prefix={<RefreshCw size={16} />} onClick={resetStats}>
            Reset Statistics
          </Button>
          <Button
            type="secondary"
            size="small"
            prefix={<Plus size={16} />}
            onClick={() =>
              ask({
                title: 'Add Measurement',
                columns: 2,
                fields: [
                  { key: 'ch', label: 'Channel', type: 'select', options: ['C1', 'C2', 'M1'] },
                  { key: 'm', label: 'Measurement', type: 'select', options: MEASURES }
                ],
                submitLabel: 'Add Measurement',
                onSubmit: (v) => {
                  s.set({ measurements: [...s.measurements, { id: Date.now(), ch: v.ch as ChannelId, m: v.m }] })
                  toast(`${v.m} added for ${v.ch}`)
                }
              })
            }
          >
            Add Measurement
          </Button>
        </div>
      </div>
      <Table
        compact
        caption="Measurements"
        rowKey={(r) => r.id}
        columns={[
          { key: 'ch', title: 'Channel', render: (r) => <span className="inline-flex items-center gap-2"><span className="h-0.5 w-3" style={{ background: COLOR[r.ch as ChannelId] }} />{r.ch}</span> },
          { key: 'm', title: 'Measurement' },
          { key: 'v', title: 'Value', align: 'right' },
          { key: 'mn', title: 'Min', align: 'right' },
          { key: 'av', title: 'Average', align: 'right' },
          { key: 'mx', title: 'Max', align: 'right' },
          { key: 'n', title: 'Count', align: 'right' },
          {
            key: 'x',
            title: <span className="sr-only">Actions</span>,
            width: 40,
            render: (r) => (
              <Button type="tertiary" size="small" svgOnly aria-label={`Remove ${r.m} for ${r.ch}`} tooltip className="!size-7" onClick={() => s.set({ measurements: s.measurements.filter((m) => m.id !== r.id) })}>
                <Trash2 size={14} />
              </Button>
            )
          }
        ]}
        rows={measRows}
      />
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </SplitPage>
  )
}


/** DIO 0–1 under the analog plot, sharing its time axis. */
function Digital({ t }: { t: Float64Array }) {
  const rows = [
    { name: 'D0', f: 1000 },
    { name: 'D1', f: 2000 }
  ]
  return (
    <Material className="flex flex-col gap-1 p-2">
      {rows.map((r) => {
        let d = ''
        for (let i = 0; i < t.length; i += 4) {
          const hi = ((((t[i] * r.f) % 1) + 1) % 1) < 0.5
          const x = (i / (t.length - 1)) * 1000
          d += (i === 0 ? 'M' : 'H') + x.toFixed(1) + (i === 0 ? ',' : 'V') + (hi ? 4 : 24)
        }
        return (
          <div key={r.name} className="grid h-6 grid-cols-[48px_minmax(0,1fr)] items-center gap-2">
            <span className="font-mono text-xs text-gray-900">{r.name}</span>
            <svg viewBox="0 0 1000 28" preserveAspectRatio="none" role="img" aria-label={r.name} className="block h-5 w-full">
              <path d={d} fill="none" stroke="var(--wf-dio)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        )
      })}
    </Material>
  )
}
