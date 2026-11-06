// Logic Analyzer (board: Logic). Digital signals and decoded interpreter rows on one time axis, with
// zoom, cursors, a hover probe, capture history, a decoded data table and the acquisition settings.
import {
  Button, DotsMenu, Entity, FormModal, Input, Material, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger, Select, StatusDot, Switch, Table, Tabs, Textarea,
  type FormField
} from '@robcholz/geist'
import {
  Activity, ArrowDown, ArrowUp, Binary, ChevronDown, ChevronLeft, ChevronRight, Crosshair, Download, Eye, FileCode, Layers, List, Maximize2, Pencil, Play, Plus,
  ScrollText, Search, Square, StepForward, Trash2, Upload, X, ZoomIn, ZoomOut
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { axisTicks, si } from '../components/format'
import { Grid2, LabeledSelect, PageBar, PanelSection, SplitPage } from '../components/Page'
import { UnitInput } from '../components/UnitInput'
import { useInterval } from '../components/useInterval'
import { capture, decodeBus, decodeSpi, decodeUart, DURATION, levelAt, pulseStats, type DigitalSignal, type Frame } from '../sim/logic'
import type { LogicReply } from '../../../shared/hw'
import { hw, useHardware } from '../devices'
import { publish, saveImage, saveTable, saveText, type Table as DataTable } from '../files'
import { toggleLoggingFor, useLoggingOf } from '../logging'
import { useStore } from '../store'

const TRIGGERS = ['Ignore', 'Low', 'High', 'Rising', 'Falling', 'Either Edge']
const ROWS = { 'Compact Rows': 24, 'Default Rows': 32, 'Tall Rows': 44 } as const
const TABS = ['Signals', 'Data', 'Notes'] as const
const HISTORY = 16

const pinOf = (io: string) => Number(/\d+/.exec(io)?.[0] ?? -1)

/** Edge lists for each named signal from a real capture (bit n of each word is DIO n). */
function toSignals(r: LogicReply, sigs: Sig[]): Record<string, DigitalSignal> {
  const out: Record<string, DigitalSignal> = {}
  for (const g of sigs) {
    const pin = pinOf(g.io)
    if (pin < 0) continue
    const bit = (w: number) => ((w >> pin) & 1) as 0 | 1
    const init = bit(r.data[0] ?? 0)
    const edges: number[] = []
    let level = init
    for (let i = 1; i < r.data.length; i++) {
      const b = bit(r.data[i])
      if (b !== level) {
        edges.push(i / r.rate)
        level = b
      }
    }
    out[g.id] = { init, edges }
  }
  return out
}

/** One row per edge with every signal's level, for Export and Logging. */
function edgeTable(signals: Record<string, DigitalSignal>, sigs: Sig[]): DataTable {
  const list = sigs.filter((g) => signals[g.id])
  const times = [...new Set([0, ...list.flatMap((g) => signals[g.id].edges)])].sort((a, b) => a - b)
  const data: number[][] = [times]
  for (const g of list) {
    const { init, edges } = signals[g.id]
    let k = 0
    data.push(times.map((t) => {
      while (k < edges.length && edges[k] <= t) k++
      return k % 2 ? 1 - init : init
    }))
  }
  return { columns: ['Time (s)', ...list.map((g) => `${g.name} (${g.io})`)], data, at: Date.now() }
}

interface Sig {
  id: string
  name: string
  io: string
  trigger: string
}
type InterpKind = 'Bus' | 'SPI' | 'I2C' | 'UART' | 'CAN' | 'I2S'
interface Interp {
  id: string
  kind: InterpKind
  title: string
  pins: string
}

interface LogicState {
  running: boolean
  mode: 'Auto' | 'Normal' | 'None'
  runMode: string
  signals: Sig[]
  hidden: string[]
  interps: Interp[]
  rowHeight: keyof typeof ROWS
  notes: string
  time: { position: number; rate: number; samples: number; triggerPos: number }
  trigger: { source: string; mode: string; length: number; count: number; clock: string; glitch: string }
  set: (p: Partial<Omit<LogicState, 'set'>>) => void
}

const useLogic = create<LogicState>()(
  persist(
    (set) => ({
      running: true,
      mode: 'Auto',
      runMode: 'Repeated',
      signals: [
        { id: 'SCK', name: 'SCK', io: 'DIO 0', trigger: 'Rising' },
        { id: 'MOSI', name: 'MOSI', io: 'DIO 1', trigger: 'Ignore' },
        { id: 'MISO', name: 'MISO', io: 'DIO 2', trigger: 'Ignore' },
        { id: 'CS', name: 'CS', io: 'DIO 3', trigger: 'Falling' },
        { id: 'TX', name: 'TX', io: 'DIO 4', trigger: 'Ignore' },
        { id: 'RX', name: 'RX', io: 'DIO 5', trigger: 'Ignore' }
      ],
      hidden: [],
      interps: [
        { id: 'spi', kind: 'SPI', title: 'SPI Flash', pins: 'DIO 0–3, Mode 0, MSB first' },
        { id: 'uart', kind: 'UART', title: 'UART Console', pins: 'DIO 4–5, 250 kBd, 8N1' }
      ],
      rowHeight: 'Default Rows',
      notes: '',
      time: { position: 0, rate: 100e6, samples: 16384, triggerPos: 10 },
      trigger: { source: 'Pins', mode: 'Simple', length: 2e-6, count: 1, clock: 'Internal', glitch: 'Off' },
      set: (p) => set(p)
    }),
    { name: 'oscillo.logic', partialize: ({ set: _s, ...r }) => r }
  )
)

const interpIcon = (k: InterpKind) => (k === 'Bus' ? <Layers size={16} /> : <Binary size={16} />)

function decode(it: Interp, sig: Record<string, DigitalSignal>): Frame[] {
  if (it.kind === 'SPI') return decodeSpi(sig)
  if (it.kind === 'UART') {
    const rx = decodeUart(sig.RX).map((f) => ({ ...f, mi: f.text }))
    const tx = decodeUart(sig.TX).map((f) => ({ ...f, mo: f.text }))
    return [...tx, ...rx].sort((a, b) => a.start - b.start)
  }
  if (it.kind === 'Bus') return decodeBus(sig, ['SCK', 'MOSI', 'MISO', 'CS'])
  return []
}

export function Logic() {
  const s = useLogic()
  const app = useStore()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Signals')
  const [latest, setLatest] = useState(HISTORY)
  const [capIndex, setCapIndex] = useState(HISTORY)
  const [view, setView] = useState<[number, number]>([0, DURATION])
  const [cursors, setCursors] = useState<number[]>([DURATION * 0.25, DURATION * 0.5])
  const [labels, setLabels] = useState<{ t: number; text: string }[]>([])
  const [filter, setFilter] = useState('')
  const [probe, setProbe] = useState<number | null>(null)
  const logging = useLoggingOf('Logic Analyzer')
  const [more, setMore] = useState(false)
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void }>(null)
  const live = s.running && app.running && !!app.device
  const toast = app.toast

  const real = useHardware()
  // Live acquisition: a new capture every half second, keeping the last 16.
  useInterval(() => {
    setLatest((n) => n + 1)
    setCapIndex((i) => (i === latest ? latest + 1 : i))
  }, 500, live && s.runMode !== 'Record' && !real)

  // A real device: captures back to back at 100 MS/s, triggered by the signals' trigger settings.
  const hwCaps = useRef(new Map<number, Record<string, DigitalSignal>>())
  const latestRef = useRef(latest)
  latestRef.current = latest
  const [singleShot, setSingleShot] = useState(0)
  const acquire = async (): Promise<boolean> => {
    const st = useLogic.getState()
    const rise = st.mode === 'None' ? [] : st.signals.filter((g) => g.trigger === 'Rising' || g.trigger === 'Either').map((g) => pinOf(g.io))
    const fall = st.mode === 'None' ? [] : st.signals.filter((g) => g.trigger === 'Falling' || g.trigger === 'Either').map((g) => pinOf(g.io))
    try {
      const r = await hw!.logic({ rate: 100e6, samples: 16384, trigger: { rise, fall, position: st.time.triggerPos / 100, autoTimeout: st.mode === 'Auto' ? 0.5 : 4 } })
      const k = Math.max(latestRef.current, ...hwCaps.current.keys()) + 1
      hwCaps.current.set(k, toSignals(r, st.signals))
      hwCaps.current.delete(k - HISTORY)
      setLatest(k)
      setCapIndex(k)
      return true
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      // Normal mode waits for a trigger; a timeout just means none came yet.
      if (st.mode === 'Normal' && /timed out/.test(msg)) return true
      toast('Capture failed', { detail: msg })
      return false
    }
  }
  useEffect(() => {
    if (!real || !(live || singleShot)) return
    let alive = true
    void (async () => {
      do {
        if (!(await acquire())) break
      } while (alive && live && useLogic.getState().runMode !== 'Record')
      if (alive) setSingleShot(0)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, live, singleShot])

  const first = Math.max(1, latest - HISTORY + 1)
  const cap = useMemo(() => (real ? { index: capIndex, signals: hwCaps.current.get(capIndex) ?? {} } : capture(capIndex)), [capIndex, real])
  useEffect(() => {
    if (Object.keys(cap.signals).length) publish('Logic Analyzer', edgeTable(cap.signals, s.signals))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cap])
  const frames = useMemo(() => s.interps.map((it) => ({ it, frames: decode(it, cap.signals) })), [s.interps, cap])
  // UART shows TX and RX on their own lanes; other interpreters use one lane.
  const lanes = frames.flatMap(({ it, frames: fr }) =>
    it.kind === 'UART'
      ? [
          { key: it.id + 'tx', it, label: it.title, dir: 'TX', frames: fr.filter((f) => f.mo) },
          { key: it.id + 'rx', it, label: it.title, dir: 'RX', frames: fr.filter((f) => f.mi) }
        ]
      : [{ key: it.id, it, label: it.title, dir: '', frames: fr }]
  )
  const clk = pulseStats(cap.signals.SCK)

  const [v0, v1] = view
  const span = v1 - v0
  const rowH = ROWS[s.rowHeight]
  const shown = s.signals.filter((g) => !s.hidden.includes(g.id) && (g.name + ' ' + g.io).toLowerCase().includes(filter.toLowerCase()))
  const frac = (t: number) => (t - v0) / span

  const zoom = (factor: number, at = (v0 + v1) / 2) => {
    const w = Math.min(DURATION, Math.max(DURATION / 256, span * factor))
    let a = at - (at - v0) * (w / span)
    a = Math.max(0, Math.min(DURATION - w, a))
    setView([a, a + w])
  }

  const run = () => {
    if (!app.device) return toast('No device connected', { detail: 'Connect a device, then press Run.' })
    if (!app.running) app.setRunning(true)
    s.set({ running: !s.running })
  }
  const single = () => {
    if (!app.device) return toast('No device connected', { detail: 'Connect a device, then press Single.' })
    s.set({ running: false })
    if (real) return setSingleShot((n) => n + 1)
    setLatest(latest + 1)
    setCapIndex(latest + 1)
    toast('Captured one acquisition')
  }

  const addSignal = () => {
    const used = new Set(s.signals.map((g) => g.io))
    const pin = Array.from({ length: 16 }, (_, i) => `DIO ${i}`).find((p) => !used.has(p))
    if (!pin) return toast('All 16 pins are in use', { detail: 'Remove a signal to add another.' })
    const id = pin.replace(' ', '')
    s.set({ signals: [...s.signals, { id, name: id, io: pin, trigger: 'Ignore' }] })
  }
  const addInterp = (kind: InterpKind) => {
    const n = s.interps.filter((i) => i.kind === kind).length
    const defaults: Record<InterpKind, string> = {
      Bus: 'DIO 0–3, 4 bits',
      SPI: 'DIO 0–3, Mode 0, MSB first',
      I2C: 'DIO 6–7, 100 kHz',
      UART: 'DIO 4–5, 250 kBd, 8N1',
      CAN: 'DIO 8, 500 kbit/s',
      I2S: 'DIO 9–11, 16 bit'
    }
    s.set({ interps: [...s.interps, { id: kind.toLowerCase() + Date.now(), kind, title: kind + (n ? ' ' + (n + 1) : ''), pins: defaults[kind] }] })
    toast(`Added ${kind} interpreter`)
  }
  const editInterp = (it: Interp) =>
    setDialog({
      title: `Edit ${it.title}`,
      submitLabel: 'Save',
      fields: [
        { key: 'title', label: 'Name', value: it.title, required: true },
        { key: 'pins', label: 'Pins and Format', value: it.pins, required: true }
      ],
      onSubmit: (v) => s.set({ interps: s.interps.map((x) => (x.id === it.id ? { ...x, title: v.title, pins: v.pins } : x)) })
    })
  const moveSignal = (id: string, d: -1 | 1) => {
    const i = s.signals.findIndex((g) => g.id === id)
    const j = i + d
    if (j < 0 || j >= s.signals.length) return
    const next = s.signals.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    s.set({ signals: next })
  }

  const addMenu = (
    <>
      <MenuItem prefix={<Activity size={16} />} onSelect={addSignal}>Signal</MenuItem>
      <MenuItem prefix={<Layers size={16} />} onSelect={() => addInterp('Bus')}>Bus</MenuItem>
      <MenuSeparator />
      {(['SPI', 'I2C', 'UART', 'CAN', 'I2S'] as const).map((k) => (
        <MenuItem key={k} prefix={<Binary size={16} />} onSelect={() => addInterp(k)}>
          {k}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem prefix={<FileCode size={16} />} onSelect={() => app.go('script')}>Custom (TypeScript)</MenuItem>
    </>
  )

  const bar = (
    <PageBar title="Logic Analyzer" status={<StatusDot state={live ? (s.mode === 'Normal' ? 'BUILDING' : 'READY') : 'QUEUED'} label={live ? (s.mode === 'Normal' ? 'Armed' : 'Running') : 'Stopped'} />}>
      <Switch aria-label="Trigger Mode" value={s.mode} options={['Auto', 'Normal', 'None'] as const} onChange={(mode) => s.set({ mode })} />
      <div className="w-[148px]">
        <Select size="small" aria-label="Run Mode" value={s.runMode} options={['Repeated', 'Scan Screen', 'Scan Shift', 'Record']} onValueChange={(runMode) => s.set({ runMode })} />
      </div>
      <Button size="small" type="secondary" prefix={<StepForward size={16} />} onClick={single}>
        Single
      </Button>
      <Button size="small" prefix={live ? <Square size={16} /> : <Play size={16} />} onClick={run} tooltipKeys={['Space']}>
        {live ? 'Stop' : 'Run'}
      </Button>
    </PageBar>
  )

  // Grid shared by the header and every row: handle, IO, name, trigger, plot.
  const grid = 'grid grid-cols-[24px_56px_88px_112px_minmax(0,1fr)] items-center gap-2 px-2'

  const signalPath = (g: DigitalSignal) => {
    const y = (l: number) => (l ? 4 : 24)
    let l = levelAt(g, v0)
    let d = `M0,${y(l)}`
    for (const e of g.edges) {
      if (e <= v0) continue
      if (e >= v1) break
      const x = (frac(e) * 1000).toFixed(1)
      l = (1 - l) as 0 | 1
      d += ` H${x} V${y(l)}`
    }
    return d + ' H1000'
  }

  const frameRow = (fr: Frame[], empty: string) => {
    const vis = fr.filter((f) => f.end > v0 && f.start < v1)
    if (!fr.length) return <span className="text-xs text-gray-700">{empty}</span>
    return (
      <div className="relative h-5 w-full">
        {vis.map((f, i) => {
          const l = Math.max(0, frac(f.start))
          const r = Math.min(1, frac(f.end))
          return (
            <span
              key={i}
              className="absolute top-0 flex h-5 items-center justify-center overflow-hidden rounded-[4px] bg-teal-200 font-mono text-[11px] text-teal-1000 shadow-[inset_0_0_0_1px_var(--teal-500)]"
              style={{ left: l * 100 + '%', width: Math.max(0.2, (r - l) * 100) + '%' }}
              title={`${f.text} at ${si(f.start, 's', 3)}`}
            >
              {(r - l) * 1000 > 28 ? f.text : ''}
            </span>
          )
        })}
      </div>
    )
  }

  const plotRef = useRef<HTMLDivElement>(null)
  const tAt = (clientX: number) => {
    const r = plotRef.current!.getBoundingClientRect()
    return v0 + ((clientX - r.left) / r.width) * span
  }
  const dragCursor = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const t = Math.max(v0, Math.min(v1, tAt(ev.clientX)))
      setCursors((c) => c.map((x, k) => (k === i ? t : x)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const ticks = Array.from({ length: 5 }, (_, i) => v0 + (span * i) / 4)

  const signalsTab = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex">
            <Button type="secondary" size="small" prefix={<Plus size={16} />} className="rounded-r-none" onClick={addSignal}>
              Add Signal
            </Button>
            <MenuRoot>
              <MenuTrigger asChild>
                <Button type="secondary" size="small" svgOnly aria-label="Add Bus or Interpreter" tooltip className="ml-px rounded-l-none">
                  <ChevronDown size={16} />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">{addMenu}</MenuContent>
            </MenuRoot>
          </div>
          <div className="w-[180px]">
            <Input
              size="small"
              aria-label="Filter Signals"
              placeholder="Filter Signals"
              prefix={<Search size={14} />}
              suffix={
                filter ? (
                  <button type="button" aria-label="Clear Filter" className="flex text-gray-900 hover:text-gray-1000" onClick={() => setFilter('')}>
                    <X size={14} />
                  </button>
                ) : undefined
              }
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="w-[148px]">
            <Select size="small" aria-label="Row Height" value={s.rowHeight} options={Object.keys(ROWS)} onValueChange={(v) => s.set({ rowHeight: v as keyof typeof ROWS })} />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button type="tertiary" size="small" svgOnly aria-label="Zoom In" tooltip disabled={span <= DURATION / 256} onClick={() => zoom(0.5)}>
            <ZoomIn size={16} />
          </Button>
          <Button type="tertiary" size="small" svgOnly aria-label="Zoom Out" tooltip disabled={span >= DURATION} onClick={() => zoom(2)}>
            <ZoomOut size={16} />
          </Button>
          <Button type="tertiary" size="small" svgOnly aria-label="Show Entire Capture" tooltip disabled={span >= DURATION} onClick={() => setView([0, DURATION])}>
            <Maximize2 size={16} />
          </Button>
          <Button type="tertiary" size="small" svgOnly aria-label={cursors.length >= 4 ? 'Remove Extra Cursors' : 'Add Cursor'} tooltip onClick={() => setCursors(cursors.length >= 4 ? cursors.slice(0, 2) : [...cursors, v0 + span * (0.3 + cursors.length * 0.1)])}>
            <Crosshair size={16} />
          </Button>
          <Button
            type="tertiary"
            size="small"
            svgOnly
            aria-label="Add Label"
            tooltip
            onClick={() => setDialog({ title: 'Add Label', submitLabel: 'Add Label', fields: [{ key: 't', label: 'Label Text', placeholder: 'First flash read', required: true }], onSubmit: (v) => setLabels([...labels, { t: probe ?? v0 + span * 0.6, text: v.t }]) })}
          >
            <Pencil size={16} />
          </Button>
          <DotsMenu
            aria-label="Plot Actions"
            menu={
              <>
                <MenuItem prefix={<Download size={16} />} onSelect={() => void saveTable('logic.csv', edgeTable(cap.signals, shown))}>Export Data</MenuItem>
                <MenuItem prefix={<Upload size={16} />} onSelect={() => void saveImage('logic.png')}>Export Image</MenuItem>
                <MenuItem prefix={<ScrollText size={16} />} onSelect={() => toggleLoggingFor('Logic Analyzer')}>{logging ? 'Stop Logging' : 'Start Logging'}</MenuItem>
                <MenuSeparator />
                <MenuItem prefix={<ZoomIn size={16} />} onSelect={() => zoom(0.25)}>Zoom to Center</MenuItem>
              </>
            }
          />
        </div>
      </div>
      <Material className="overflow-hidden">
        <div className={`${grid} h-9 text-[13px] text-gray-900 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]`}>
          <span />
          <span>IO</span>
          <span>Name</span>
          <span>Trigger</span>
          <span className="flex justify-between tabular-nums">
            {axisTicks(ticks, 's').map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </span>
        </div>
        <div className="relative">
          {shown.map((g) => {
            const sig = cap.signals[g.id] ?? { init: 0, edges: [] }
            return (
              <div key={g.id} className={grid} style={{ height: rowH + 8 }}>
                <DotsMenu
                  aria-label={`${g.name} Actions`}
                  menu={
                    <>
                      <MenuItem prefix={<Pencil size={16} />} onSelect={() => setDialog({ title: `Rename ${g.name}`, submitLabel: 'Rename', fields: [{ key: 'n', label: 'Name', value: g.name, required: true }], onSubmit: (v) => s.set({ signals: s.signals.map((x) => (x.id === g.id ? { ...x, name: v.n } : x)) }) })}>Rename</MenuItem>
                      <MenuItem prefix={<ArrowUp size={16} />} onSelect={() => moveSignal(g.id, -1)}>Move Up</MenuItem>
                      <MenuItem prefix={<ArrowDown size={16} />} onSelect={() => moveSignal(g.id, 1)}>Move Down</MenuItem>
                      <MenuItem prefix={<Eye size={16} />} onSelect={() => s.set({ hidden: [...s.hidden, g.id] })}>Hide</MenuItem>
                      <MenuSeparator />
                      <MenuItem danger prefix={<Trash2 size={16} />} onSelect={() => s.set({ signals: s.signals.filter((x) => x.id !== g.id) })}>Remove</MenuItem>
                    </>
                  }
                />
                <span className="font-mono text-xs text-gray-900">{g.io}</span>
                <span className="truncate text-[13px] font-medium">{g.name}</span>
                <Select size="small" aria-label={`${g.name} trigger`} value={g.trigger} options={TRIGGERS} onValueChange={(trigger) => s.set({ signals: s.signals.map((x) => (x.id === g.id ? { ...x, trigger } : x)) })} />
                <svg viewBox="0 0 1000 28" preserveAspectRatio="none" role="img" aria-label={`${g.name} signal`} className="w-full" style={{ height: rowH - 4 }}>
                  <path d={signalPath(sig)} fill="none" stroke="var(--green-900)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
                </svg>
              </div>
            )
          })}
          {lanes.map(({ key, it, label, dir, frames: fr }) => (
            <div key={key} className={grid} style={{ height: rowH + 8 }}>
              <ChevronDown size={16} className="text-gray-700" aria-hidden />
              <span className="font-mono text-xs text-gray-900">{it.kind}</span>
              <span className="truncate text-[13px] font-medium" title={label}>{label}</span>
              <span className="text-xs text-gray-900">{dir ? `${dir} Interpreter` : 'Interpreter'}</span>
              {frameRow(fr, `No ${it.kind} frames on ${it.pins.split(',')[0]}`)}
            </div>
          ))}
          {shown.length === 0 && frames.length === 0 && <div className="p-4 text-sm text-gray-900">{filter ? `No signals match “${filter}”.` : 'No signals. Use Add Signal to show a pin.'}</div>}
          {/* Plot overlay: probe, cursors and labels, aligned with the plot column. */}
          <div
            ref={plotRef}
            className="absolute inset-y-0 right-2 left-[calc(8px+24px+56px+88px+112px+32px)]"
            onPointerMove={(e) => setProbe(tAt(e.clientX))}
            onPointerLeave={() => setProbe(null)}
            onWheel={(e) => {
              if (e.metaKey || e.ctrlKey) zoom(e.deltaY > 0 ? 1.25 : 0.8, tAt(e.clientX))
              else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                const d = (e.deltaX / 1000) * span
                const a = Math.max(0, Math.min(DURATION - span, v0 + d))
                setView([a, a + span])
              }
            }}
            onDoubleClick={(e) => zoom(0.5, tAt(e.clientX))}
          >
            {cursors.map((c, i) =>
              c >= v0 && c <= v1 ? (
                <span key={i} className="absolute inset-y-0 z-[2] border-l border-dashed border-gray-1000" style={{ left: frac(c) * 100 + '%' }}>
                  <button
                    type="button"
                    aria-label={`Move cursor X${i + 1}`}
                    onPointerDown={dragCursor(i)}
                    className="absolute -top-px left-0 h-4 -translate-x-1/2 cursor-ew-resize rounded-[4px] bg-gray-1000 px-1 text-[11px] font-semibold leading-4 text-background-100"
                  >
                    X{i + 1}
                  </button>
                </span>
              ) : null
            )}
            {labels.map((l, i) =>
              l.t >= v0 && l.t <= v1 ? (
                <span key={i} className="absolute bottom-2 z-[2] h-[22px] whitespace-nowrap rounded-small bg-background-100 px-2 text-xs leading-[22px] shadow-[0_0_0_1px_var(--gray-alpha-600)]" style={{ left: frac(l.t) * 100 + '%' }}>
                  {l.text}
                </span>
              ) : null
            )}
            {probe !== null && (
              <>
                <span className="pointer-events-none absolute inset-y-0 border-l border-gray-alpha-600" style={{ left: frac(probe) * 100 + '%' }} />
                <div
                  className="pointer-events-none absolute top-2 z-[4] min-w-[150px] rounded-small bg-background-100 px-2 py-1.5 text-xs shadow-tooltip"
                  style={frac(probe) > 0.7 ? { right: (1 - frac(probe)) * 100 + '%', marginRight: 8 } : { left: frac(probe) * 100 + '%', marginLeft: 8 }}
                >
                  <div className="mb-1 text-gray-900">t = {si(probe, 's', 4)}</div>
                  {shown.map((g) => (
                    <div key={g.id} className="flex justify-between gap-4 font-mono">
                      <span className="text-gray-900">{g.name}</span>
                      <span>{cap.signals[g.id] ? levelAt(cap.signals[g.id], probe) : 0}</span>
                    </div>
                  ))}
                  {lanes.map(({ key, label, frames: fr }) => {
                    const f = fr.find((x) => x.start <= probe && x.end >= probe)
                    return f ? (
                      <div key={key} className="flex justify-between gap-4 font-mono">
                        <span className="text-gray-900">{label}</span>
                        <span>{f.text}</span>
                      </div>
                    ) : null
                  })}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-[13px] tabular-nums shadow-[inset_0_1px_0_var(--gray-alpha-400)]">
          <span className="flex gap-4">
            {clk ? (
              <>
                <span>Pulse Width {si(clk.width, 's', 3)}</span>
                <span>Period {si(clk.period, 's', 3)}</span>
                <span>Frequency {si(1 / clk.period, 'Hz', 3)}</span>
              </>
            ) : (
              <span className="text-gray-900">No clock activity</span>
            )}
          </span>
          <span className="text-gray-900">
            16,384 Samples · 100 MS/s · {si(DURATION, 's', 4)}
            {cursors.length >= 2 && ` · X2 − X1 = ${si(cursors[1] - cursors[0], 's', 3)}`}
            {span < DURATION && ` · Zoom ${Math.round(DURATION / span)}×`}
          </span>
        </div>
      </Material>
    </>
  )

  const rows = frames
    .flatMap(({ it, frames: fr }) => (it.kind === 'Bus' ? [] : fr.map((f) => ({ ...f, i: it.title }))))
    .sort((a, b) => a.start - b.start)
    .map((f, k) => ({ id: k, i: f.i, t: si(f.start, 's', 3), mo: f.mo ?? '', mi: f.mi ?? '', n: f.note ?? '' }))
  const dataTab = (
    <>
      <div className="mt-1 flex items-center justify-between">
        <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">Decoded Data</h2>
        <div className="flex gap-2">
          <Button type="tertiary" size="small" prefix={<ScrollText size={16} />} onClick={() => toggleLoggingFor('Logic Analyzer')}>
            {logging ? 'Stop Logging' : 'Start Logging'}
          </Button>
          <Button type="secondary" size="small" prefix={<Download size={16} />} disabled={!rows.length} onClick={() => void saveText('decoded.csv', ['Interpreter,Time,Data,MISO,Note', ...frames.flatMap(({ it, frames: fr }) => (it.kind === 'Bus' ? [] : fr.map((f) => [it.title, f.start, f.mo ?? '', f.mi ?? '', f.note ?? ''].map((x) => (typeof x === 'string' && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : String(x))).join(','))))].join('\n') + '\n')}>
            Export
          </Button>
        </div>
      </div>
      <Table
        compact
        caption="Decoded data"
        columns={[
          { key: 'i', title: 'Interpreter' },
          { key: 't', title: 'Time', align: 'right' },
          { key: 'mo', title: 'MOSI / TX', mono: true },
          { key: 'mi', title: 'MISO / RX', mono: true },
          { key: 'n', title: 'Note' }
        ]}
        rows={more ? rows : rows.slice(0, 20)}
      />
      {rows.length === 0 && <div className="text-sm text-gray-900">No decoded frames. Add an interpreter in Settings.</div>}
      {rows.length > 20 && (
        <Button type="tertiary" size="small" onClick={() => setMore(!more)} className="self-center">
          {more ? 'Show Fewer' : `Show ${rows.length - 20} More`}
        </Button>
      )}
    </>
  )

  const t = s.time
  const tr = s.trigger
  const panel = (
    <>
      <PanelSection title="Time">
        <Grid2>
          <UnitInput label="Position" value={t.position} suffix="s" onCommit={(position) => s.set({ time: { ...t, position } })} />
          <UnitInput label="Base" value={span / 10} scale={1e-6} suffix="µs/div" min={DURATION / 2560} max={DURATION / 10} onCommit={(b) => { const w = b * 10; const a = Math.max(0, Math.min(DURATION - w, (v0 + v1) / 2 - w / 2)); setView([a, a + w]) }} />
          <UnitInput label="Rate" value={t.rate} scale={1e6} suffix="MS/s" min={1e3} max={100e6} onCommit={(rate) => s.set({ time: { ...t, rate } })} />
          <UnitInput label="Samples" value={t.samples} integer min={16} max={2 ** 27} onCommit={(samples) => s.set({ time: { ...t, samples } })} />
          <UnitInput label="Trigger Position" value={t.triggerPos} suffix="%" min={0} max={100} onCommit={(triggerPos) => s.set({ time: { ...t, triggerPos } })} />
          <UnitInput label="History" value={HISTORY} suffix="captures" integer disabled onCommit={() => {}} />
        </Grid2>
      </PanelSection>
      <PanelSection title="Trigger">
        <Grid2>
          <LabeledSelect label="Source" value={tr.source} options={['Pins', 'External 1', 'External 2', 'Scope', 'Patterns', 'Manual']} onValueChange={(source) => s.set({ trigger: { ...tr, source } })} />
          <LabeledSelect label="Mode" value={tr.mode} options={['Simple', 'Pulse Length', 'Counter', 'Serial Match']} onValueChange={(mode) => s.set({ trigger: { ...tr, mode } })} />
          <UnitInput label="Length" value={tr.length} scale={1e-6} suffix="µs" min={0} disabled={tr.mode !== 'Pulse Length'} onCommit={(length) => s.set({ trigger: { ...tr, length } })} />
          <UnitInput label="Count" value={tr.count} integer min={1} disabled={tr.mode !== 'Counter'} onCommit={(count) => s.set({ trigger: { ...tr, count } })} />
          <LabeledSelect label="Clock" value={tr.clock} options={['Internal', 'External DIO 7']} onValueChange={(clock) => s.set({ trigger: { ...tr, clock } })} />
          <LabeledSelect label="Glitch Sampling" value={tr.glitch} options={['Off', 'On']} onValueChange={(glitch) => s.set({ trigger: { ...tr, glitch } })} />
        </Grid2>
      </PanelSection>
      <PanelSection
        title="Interpreters"
        actions={
          <MenuRoot>
            <MenuTrigger asChild>
              <Button type="tertiary" size="small" svgOnly aria-label="Add Interpreter" tooltip>
                <Plus size={16} />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">{addMenu}</MenuContent>
          </MenuRoot>
        }
      >
        {s.interps.length ? (
          <Material>
            {s.interps.map((it, i) => (
              <Entity key={it.id} title={it.title} description={it.pins} icon={interpIcon(it.kind)} className={i === s.interps.length - 1 ? 'shadow-none' : undefined}>
                <DotsMenu
                  aria-label={`${it.title} Actions`}
                  menu={
                    <>
                      <MenuItem prefix={<Pencil size={16} />} onSelect={() => editInterp(it)}>Edit Interpreter</MenuItem>
                      <MenuItem prefix={<List size={16} />} onSelect={() => setTab('Data')}>Show in Data View</MenuItem>
                      <MenuSeparator />
                      <MenuItem danger prefix={<Trash2 size={16} />} onSelect={() => { s.set({ interps: s.interps.filter((x) => x.id !== it.id) }); toast(`Removed ${it.title}`) }}>Remove</MenuItem>
                    </>
                  }
                />
              </Entity>
            ))}
          </Material>
        ) : (
          <div className="text-sm text-gray-900">No interpreters. Use the menu to add SPI, I2C, UART and more.</div>
        )}
        {s.hidden.length > 0 && (
          <Button type="tertiary" size="small" prefix={<Eye size={16} />} onClick={() => s.set({ hidden: [] })}>
            Show {s.hidden.length} Hidden {s.hidden.length === 1 ? 'Signal' : 'Signals'}
          </Button>
        )}
      </PanelSection>
    </>
  )

  let body: ReactNode = signalsTab
  if (tab === 'Data') body = dataTab
  if (tab === 'Notes') body = <Textarea aria-label="Capture Notes" rows={14} placeholder="Notes for this capture, saved with the workspace" value={s.notes} onChange={(e) => s.set({ notes: e.target.value })} />

  return (
    <SplitPage bar={bar} panelId="logic" panel={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={TABS.map((x) => ({ title: x, value: x }))} selected={tab} setSelected={(v) => setTab(v as (typeof TABS)[number])} />
        <div className="flex items-center gap-2">
          <Button type="tertiary" size="small" svgOnly aria-label="Previous Capture" tooltip disabled={capIndex <= first} onClick={() => setCapIndex(capIndex - 1)}>
            <ChevronLeft size={16} />
          </Button>
          <span className="text-[13px] leading-4 tabular-nums text-gray-900">
            Capture {capIndex - first + 1} of {latest - first + 1}
          </span>
          <Button type="tertiary" size="small" svgOnly aria-label="Next Capture" tooltip disabled={capIndex >= latest} onClick={() => setCapIndex(capIndex + 1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
      {body}
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </SplitPage>
  )
}
