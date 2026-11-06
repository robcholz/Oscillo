// Pattern Generator (board: Patterns). One row per signal or bus with type, output drive, idle state,
// parameters and a live preview, plus a paintable editor for the custom pattern.
import { useCommand } from '../shell/commands'
import { Button, DotsMenu, FormModal, Input, Material, MenuItem, MenuSeparator, Note, Select, SplitButton, StatusDot, Toggle, type FormField } from '@robcholz/geist'
import { Layers, Pencil, Play, Plus, Redo2, Square, Trash2, Undo2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { si } from '../components/format'
import { PageBar, ScrollPage } from '../components/Page'
import { parseSi } from '../components/UnitInput'
import type { PatternRequest } from '../../../shared/hw'
import { hw } from '../devices'
import { follow } from '../hwsync'
import { openTable } from '../files'
import { useStore } from '../store'

const TYPES = [
  ...['Constant', 'Number', 'Clock', 'Pulse', 'Random', 'Custom'].map((v) => ({ value: v, label: v, group: 'Signals' })),
  ...['Binary Counter', 'Gray Counter', 'Johnson Counter', 'Walking 1', 'Walking 0'].map((v) => ({ value: v, label: v, group: 'Sequences' }))
]
const SEQUENCES = new Set(['Binary Counter', 'Gray Counter', 'Johnson Counter', 'Walking 1', 'Walking 0'])
const OUTPUTS = ['Push-Pull', 'Open-Drain', 'Open-Source', 'Three-State']
const IDLES = ['Low', 'High', 'Z', 'Initial']

interface Row {
  id: string
  pin: number
  width: number
  name: string
  type: string
  output: string
  idle: string
  /** Hz for clocks, counters and random; seconds for pulse times. */
  freq: number
  duty: number
  phase: number
  low: number
  high: number
  level: 0 | 1
  value: number
  direction: 'Left' | 'Right'
}

const base = { output: 'Push-Pull', idle: 'Low', freq: 1e6, duty: 50, phase: 0, low: 2e-6, high: 18e-6, level: 0 as const, value: 1, direction: 'Left' as const, width: 1 }
const defaults: Row[] = [
  { ...base, id: 'clk', pin: 0, name: 'Clock', type: 'Clock' },
  { ...base, id: 'rst', pin: 1, name: 'Reset', type: 'Pulse', output: 'Open-Drain', idle: 'High' },
  { ...base, id: 'noise', pin: 2, name: 'Noise', type: 'Random', freq: 250e3 },
  { ...base, id: 'en', pin: 3, name: 'Enable', type: 'Constant', idle: 'High', level: 1 },
  { ...base, id: 'cnt', pin: 4, width: 4, name: 'Counter', type: 'Binary Counter', freq: 100e3 },
  { ...base, id: 'gray', pin: 8, width: 4, name: 'Gray', type: 'Gray Counter', freq: 100e3 },
  { ...base, id: 'ring', pin: 12, width: 2, name: 'Ring', type: 'Walking 1', freq: 50e3 },
  { ...base, id: 'data', pin: 14, name: 'Data', type: 'Custom', output: 'Three-State', idle: 'Z' },
  { ...base, id: 'mode', pin: 15, name: 'Mode', type: 'Number', value: 1 }
]
const defaultBits = Array.from({ length: 64 }, (_, i) => ((i * 7) % 11 < 5 ? 1 : 0))

interface PatternState {
  running: boolean
  trigger: string
  wait: number
  run: string
  repeat: string
  repeatTrigger: boolean
  rows: Row[]
  bits: number[]
  rate: number
  set: (p: Partial<Omit<PatternState, 'set'>>) => void
}

const usePatterns = create<PatternState>()(
  persist(
    (set) => ({
      running: false,
      trigger: 'Trigger None',
      wait: 0,
      run: 'Run Continuous',
      repeat: 'Repeat Infinite',
      repeatTrigger: false,
      rows: defaults,
      bits: defaultBits,
      rate: 1e6,
      set: (p) => set(p)
    }),
    { name: 'oscillo.patterns', partialize: ({ set: _s, ...r }) => r }
  )
)

/** One period of each bit of a sequence, bit 0 first. */
function seqBits(r: Row): number[][] {
  const n = Math.max(1, r.width)
  const type = r.type
  const walk = (i: number) => 1 << (r.direction === 'Left' ? i : n - 1 - i)
  let words: number[]
  if (type === 'Binary Counter') words = Array.from({ length: 2 ** n }, (_, i) => i)
  else if (type === 'Gray Counter') words = Array.from({ length: 2 ** n }, (_, i) => i ^ (i >> 1))
  else if (type === 'Johnson Counter') words = Array.from({ length: 2 * n }, (_, i) => (i < n ? (1 << (i + 1)) - 1 : ((1 << n) - 1) & ~((1 << (i - n + 1)) - 1)))
  else if (type === 'Walking 1') words = Array.from({ length: n }, (_, i) => walk(i))
  else words = Array.from({ length: n }, (_, i) => ((1 << n) - 1) & ~walk(i))
  return Array.from({ length: n }, (_, b) => words.map((w) => (w >> b) & 1))
}

const IDLE_MAP: Record<string, PatternRequest['idle']> = { Low: 'Low', High: 'High', Z: 'Z', Initial: 'Init' }

/** What each pin plays on real hardware. */
export function toPatterns(rows: Row[], bits: number[], rate: number): PatternRequest[] {
  const out: PatternRequest[] = []
  for (const r of rows) {
    const idle = IDLE_MAP[r.idle] ?? 'Init'
    if (r.type === 'Clock') out.push({ pin: r.pin, kind: 'Clock', frequency: r.freq, duty: r.duty, idle })
    else if (r.type === 'Pulse') out.push({ pin: r.pin, kind: 'Pulse', frequency: 1 / Math.max(1e-9, r.low + r.high), duty: (100 * r.high) / Math.max(1e-12, r.low + r.high), idle })
    else if (r.type === 'Random') out.push({ pin: r.pin, kind: 'Random', frequency: r.freq, idle })
    else if (r.type === 'Constant') out.push({ pin: r.pin, kind: 'Constant', frequency: 1, data: [r.level], idle })
    else if (r.type === 'Number') for (let b = 0; b < r.width; b++) out.push({ pin: r.pin + b, kind: 'Constant', frequency: 1, data: [(r.value >> b) & 1], idle })
    else if (r.type === 'Custom') out.push({ pin: r.pin, kind: 'Custom', frequency: rate, data: bits, idle })
    else if (SEQUENCES.has(r.type)) seqBits(r).forEach((data, b) => out.push({ pin: r.pin + b, kind: 'Custom', frequency: r.freq, data, idle }))
  }
  return out.filter((p) => p.pin >= 0 && p.pin < 32)
}

// The device plays the rows while the generator runs.
follow(
  [usePatterns],
  () => {
    const { rows, bits, rate, running } = usePatterns.getState()
    return { list: running && useStore.getState().running ? toPatterns(rows, bits, rate) : null }
  },
  async ({ list }) => {
    if (list) await hw!.patterns(list)
    else await hw!.patternsStop()
  },
  'the patterns',
  { name: 'Patterns', on: ({ list }) => !!list }
)

const pinLabel = (r: Row) => (r.width > 1 ? `DIO ${r.pin}–${r.pin + r.width - 1}` : `DIO ${r.pin}`)

function params(r: Row, bits: number[]): string {
  switch (r.type) {
    case 'Clock':
      return `${si(r.freq, 'Hz')} · ${r.duty}% · ${r.phase}°`
    case 'Pulse':
      return `Low ${si(r.low, 's')}, High ${si(r.high, 's')}`
    case 'Random':
      return si(r.freq, 'Hz')
    case 'Constant':
      return r.level ? 'High' : 'Low'
    case 'Number':
      return '0b' + r.value.toString(2)
    case 'Custom':
      return `${bits.length} Samples · Editing`
    case 'Walking 1':
    case 'Walking 0':
      return `${si(r.freq, 'Hz')} · ${r.direction}`
    default:
      return `${si(r.freq, 'Hz')} · ${r.width} bits`
  }
}

/** Ten steps of a sequence, as text cells. */
function sequence(r: Row): string[] {
  const n = r.width
  const out: string[] = []
  for (let i = 0; i < 10; i++) {
    let v = 0
    if (r.type === 'Binary Counter') v = i % 2 ** n
    else if (r.type === 'Gray Counter') v = (i ^ (i >> 1)) % 2 ** n
    else if (r.type === 'Johnson Counter') {
      const k = i % (2 * n)
      v = k < n ? (1 << (k + 1)) - 1 : ((1 << n) - 1) & ~((1 << (k - n + 1)) - 1)
    } else {
      const k = i % n
      v = 1 << (r.direction === 'Left' ? k : n - 1 - k)
      if (r.type === 'Walking 0') v = ~v & ((1 << n) - 1)
    }
    out.push(n <= 2 ? v.toString(2).padStart(n, '0') : v.toString(16).toUpperCase())
  }
  return out
}

/** Single-pin preview as 0/1 samples across the window. */
function levels(r: Row, bits: number[]): number[] {
  const N = 64
  const rnd = (i: number) => ((Math.sin(i * 12.9898 + r.pin) * 43758.5453) % 1 + 1) % 1
  return Array.from({ length: N }, (_, i) => {
    const f = i / N
    switch (r.type) {
      case 'Clock': {
        const p = (f * 8 + r.phase / 360) % 1
        return p < r.duty / 100 ? 1 : 0
      }
      case 'Pulse':
        return f * (r.low + r.high) * 2 % (r.low + r.high) < r.low ? 0 : 1
      case 'Random':
        return rnd(Math.floor(f * 16)) > 0.5 ? 1 : 0
      case 'Constant':
        return r.level
      case 'Number': {
        const b = r.value.toString(2)
        return Number(b[Math.floor(f * b.length)])
      }
      case 'Custom':
        return bits[Math.floor(f * bits.length)] ?? 0
      default:
        return 0
    }
  })
}

function path(l: number[]): string {
  const y = (v: number) => (v ? 4 : 24)
  let d = `M0,${y(l[0])}`
  for (let i = 1; i < l.length; i++) if (l[i] !== l[i - 1]) d += ` H${((i / l.length) * 1000).toFixed(1)} V${y(l[i])}`
  return d + ' H1000'
}

export function Patterns() {
  const s = usePatterns()
  const app = useStore()
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void; columns?: 1 | 2 }>(null)
  const [past, setPast] = useState<number[][]>([])
  const [future, setFuture] = useState<number[][]>([])
  const painting = useRef<number | null>(null)
  const live = s.running && app.running && !!app.device
  const toast = app.toast

  const setRow = (id: string, p: Partial<Row>) => s.set({ rows: s.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) })
  const freePins = (w: number) => {
    const used = new Set(s.rows.flatMap((r) => Array.from({ length: r.width }, (_, k) => r.pin + k)))
    for (let p = 0; p + w <= 16; p++) if (Array.from({ length: w }, (_, k) => p + k).every((x) => !used.has(x))) return p
    return null
  }
  const add = (type: string, width = 1) => {
    const pin = freePins(width)
    if (pin === null) return toast('No free pins', { detail: `Remove a row to free ${width === 1 ? 'a pin' : width + ' pins'}.` })
    const name = width > 1 ? 'Bus' : type
    s.set({ rows: [...s.rows, { ...base, id: type + Date.now(), pin, width, name, type, freq: width > 1 ? 100e3 : 1e6 }] })
    toast(`${name} added on ${width > 1 ? `DIO ${pin}–${pin + width - 1}` : `DIO ${pin}`}`)
  }

  const edit = (r: Row) => {
    const f = (key: string, label: string, value: string, suffix?: string): FormField => ({
      key,
      label,
      value,
      suffix,
      required: true,
      validate: (v) => (parseSi(v) === null ? 'Enter a number, such as 1 or 2.5k.' : null)
    })
    const fields: FormField[] =
      r.type === 'Clock'
        ? [f('freq', 'Frequency', si(r.freq).trim(), 'Hz'), f('duty', 'Duty', String(r.duty), '%'), f('phase', 'Phase', String(r.phase), '°')]
        : r.type === 'Pulse'
          ? [f('low', 'Low Time', si(r.low * 1e6).trim(), 'µs'), f('high', 'High Time', si(r.high * 1e6).trim(), 'µs')]
          : r.type === 'Constant'
            ? [{ key: 'level', label: 'Level', type: 'select', value: r.level ? 'High' : 'Low', options: ['Low', 'High'] }]
            : r.type === 'Number'
              ? [{ key: 'value', label: 'Value', value: '0b' + r.value.toString(2), mono: true, required: true, validate: (v) => (Number.isNaN(Number(v)) ? 'Enter a number such as 5, 0x1F or 0b101.' : null) }]
              : r.type.startsWith('Walking')
                ? [f('freq', 'Rate', si(r.freq).trim(), 'Hz'), { key: 'direction', label: 'Direction', type: 'select', value: r.direction, options: ['Left', 'Right'] }]
                : [f('freq', 'Rate', si(r.freq).trim(), 'Hz')]
    setDialog({
      title: `Edit ${r.name}`,
      submitLabel: 'Save',
      fields: [{ key: 'name', label: 'Name', value: r.name, required: true }, ...fields],
      onSubmit: (v) => {
        const p: Partial<Row> = { name: v.name }
        if (v.freq) p.freq = parseSi(v.freq)!
        if (v.duty) p.duty = parseSi(v.duty)!
        if (v.phase) p.phase = parseSi(v.phase)!
        if (v.low) p.low = parseSi(v.low)! * 1e-6
        if (v.high) p.high = parseSi(v.high)! * 1e-6
        if (v.level) p.level = v.level === 'High' ? 1 : 0
        if (v.value) p.value = Number(v.value)
        if (v.direction) p.direction = v.direction as Row['direction']
        setRow(r.id, p)
      }
    })
  }

  const split = (r: Row) => {
    const parts = Array.from({ length: r.width }, (_, k) => ({ ...r, id: r.id + k, pin: r.pin + k, width: 1, name: `${r.name} ${k}`, type: 'Clock', freq: r.freq / 2 ** (k + 1) }))
    s.set({ rows: s.rows.flatMap((x) => (x.id === r.id ? parts : [x])) })
    toast(`Split ${r.name} into ${r.width} signals`)
  }

  const setBits = (bits: number[]) => {
    setPast([...past.slice(-49), s.bits])
    setFuture([])
    s.set({ bits })
  }
  const paint = (i: number, v: number) => {
    if (s.bits[i] === v) return
    const next = s.bits.slice()
    next[i] = v
    s.set({ bits: next })
  }
  const custom = s.rows.find((r) => r.type === 'Custom')
  const undo = (): void => {
    if (!past.length) return
    setFuture([s.bits, ...future])
    s.set({ bits: past[past.length - 1] })
    setPast(past.slice(0, -1))
  }
  const redo = (): void => {
    if (!future.length) return
    setPast([...past, s.bits])
    s.set({ bits: future[0] })
    setFuture(future.slice(1))
  }
  useCommand('undo', undo, !!custom)
  useCommand('redo', redo, !!custom)

  const run = () => {
    if (!app.device) return toast('No device connected', { detail: 'Connect a device, then press Run.' })
    if (!app.running) app.setRunning(true)
    s.set({ running: !s.running })
    toast(s.running ? 'Patterns stopped' : `Patterns running on ${s.rows.reduce((n, r) => n + r.width, 0)} pins`)
  }

  const grid = 'grid grid-cols-[72px_96px_160px_128px_104px_160px_minmax(160px,1fr)_32px] items-center gap-3 px-3'

  return (
    <ScrollPage
      className="flex flex-col gap-3"
      bar={
        <PageBar title="Pattern Generator" status={<StatusDot state={live ? 'READY' : 'QUEUED'} label={live ? 'Running' : 'Stopped'} />}>
          <div className="w-[168px]">
            <Select size="small" aria-label="Trigger" value={s.trigger} options={['Trigger None', 'Trigger Manual', 'Trigger External 1', 'Trigger Scope']} onValueChange={(trigger) => s.set({ trigger })} />
          </div>
          <div className="w-[128px]">
            <Input
              size="small"
              aria-label="Wait"
              prefix={<span className="text-[13px] text-gray-900">Wait</span>}
              suffix={<span className="text-[13px] text-gray-700">s</span>}
              defaultValue={String(s.wait)}
              onBlur={(e) => {
                const v = parseSi(e.target.value)
                if (v !== null && v >= 0) s.set({ wait: v })
                else e.target.value = String(s.wait)
              }}
            />
          </div>
          <div className="w-[156px]">
            <Select size="small" aria-label="Run" value={s.run} options={['Run Continuous', 'Run Timed']} onValueChange={(run) => s.set({ run })} />
          </div>
          <div className="w-[156px]">
            <Select size="small" aria-label="Repeat" value={s.repeat} options={['Repeat Infinite', 'Repeat Count']} onValueChange={(repeat) => s.set({ repeat })} />
          </div>
          <Button size="small" prefix={live ? <Square size={16} /> : <Play size={16} />} onClick={run} tooltipKeys={['Space']}>
            {live ? 'Stop' : 'Run'}
          </Button>
        </PageBar>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <SplitButton
          prefix={<Plus size={16} />}
          onClick={() => add('Clock')}
          menuLabel="More signal types"
          menu={['Constant', 'Clock', 'Pulse', 'Random', 'Number', 'Custom'].map((t) => (
            <MenuItem key={t} onSelect={() => add(t)}>
              {t}
            </MenuItem>
          ))}
        >
          Add Signal
        </SplitButton>
        <Button type="tertiary" size="small" prefix={<Layers size={16} />} onClick={() => add('Binary Counter', 4)}>
          Add Bus
        </Button>
        <Button type="tertiary" size="small" prefix={<Upload size={16} />} onClick={async () => {
          const f = await openTable()
          if (!f) return
          // The last column holds the samples, so a time column in front is skipped.
          const col = f.data[f.data.length - 1].slice(0, 1024).map((v) => (v > 0.5 ? 1 : 0))
          setBits(col)
          toast(`Imported ${f.name}`, { detail: `${col.length} samples into the custom pattern. Values above 0.5 are high.` })
        }}>
          Import CSV
        </Button>
        <Toggle checked={s.repeatTrigger} onChange={(repeatTrigger) => s.set({ repeatTrigger })}>
          Repeat Trigger
        </Toggle>
      </div>
      <Material className="overflow-x-auto">
        <div className="min-w-[1000px]">
          <div className={`${grid} h-9 text-[13px] text-gray-900 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]`}>
            <span>DIO</span>
            <span>Name</span>
            <span>Type</span>
            <span>Output</span>
            <span>Idle</span>
            <span>Parameters</span>
            <span>Preview</span>
            <span />
          </div>
          {s.rows.map((r) => (
            <div key={r.id} className={`${grid} h-12 shadow-[inset_0_-1px_0_var(--gray-alpha-200)] last:shadow-none`}>
              <span className="font-mono text-xs text-gray-900">{pinLabel(r)}</span>
              <span className="truncate text-[13px] font-medium">{r.name}</span>
              <Select size="small" aria-label={`${r.name} type`} value={r.type} options={r.width > 1 ? TYPES.filter((t) => SEQUENCES.has(t.value)) : TYPES.filter((t) => !SEQUENCES.has(t.value))} onValueChange={(type) => setRow(r.id, { type })} />
              <Select size="small" aria-label={`${r.name} output`} value={r.output} options={OUTPUTS} onValueChange={(output) => setRow(r.id, { output })} />
              <Select size="small" aria-label={`${r.name} idle`} value={r.idle} options={IDLES} onValueChange={(idle) => setRow(r.id, { idle })} />
              <button type="button" className="truncate text-left text-[13px] tabular-nums text-gray-900 hover:text-gray-1000" onClick={() => edit(r)}>
                {params(r, s.bits)}
              </button>
              {SEQUENCES.has(r.type) ? (
                <div className="flex h-7" role="img" aria-label={`${r.name} preview`}>
                  {sequence(r).map((v, i) => (
                    <span key={i} className="flex flex-1 items-center justify-center font-mono text-xs text-gray-1000 shadow-[inset_-1px_0_0_var(--gray-alpha-400)]">
                      {v}
                    </span>
                  ))}
                </div>
              ) : (
                <svg viewBox="0 0 1000 28" preserveAspectRatio="none" role="img" aria-label={`${r.name} preview`} className="h-7 w-full">
                  <path d={path(levels(r, s.bits))} fill="none" stroke={r.idle === 'Z' && r.type === 'Custom' ? 'var(--wf-c2)' : 'var(--green-900)'} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
                </svg>
              )}
              <DotsMenu
                aria-label={`${r.name} actions`}
                menu={
                  <>
                    <MenuItem prefix={<Pencil size={16} />} onSelect={() => edit(r)}>Edit Parameters</MenuItem>
                    <MenuItem prefix={<Layers size={16} />} disabled={r.width === 1} onSelect={() => split(r)}>Split Bus</MenuItem>
                    <MenuSeparator />
                    <MenuItem danger prefix={<Trash2 size={16} />} onSelect={() => { s.set({ rows: s.rows.filter((x) => x.id !== r.id) }); toast(`Removed ${r.name}`) }}>Remove</MenuItem>
                  </>
                }
              />
            </div>
          ))}
          {s.rows.length === 0 && <div className="p-4 text-sm text-gray-900">No signals. Use Add Signal to drive a pin.</div>}
        </div>
      </Material>
      {custom && (
        <Material className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">
              Custom Editor · {pinLabel(custom)} {custom.name}
            </h2>
            <div className="flex items-center gap-1">
              <Button type="tertiary" size="small" svgOnly aria-label="Undo" tooltip tooltipKeys={['⌘', 'Z']} disabled={!past.length} onClick={undo}>
                <Undo2 size={16} />
              </Button>
              <Button type="tertiary" size="small" svgOnly aria-label="Redo" tooltip tooltipKeys={['⇧', '⌘', 'Z']} disabled={!future.length} onClick={redo}>
                <Redo2 size={16} />
              </Button>
              <div className="w-24">
                <Input
                  size="small"
                  aria-label="Samples"
                  defaultValue={String(s.bits.length)}
                  key={s.bits.length}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  onBlur={(e) => {
                    const n = Math.round(Number(e.target.value))
                    if (!(n >= 2 && n <= 256)) {
                      e.target.value = String(s.bits.length)
                      return toast('Samples must be 2 to 256', { detail: 'Enter a whole number in that range.' })
                    }
                    setBits(Array.from({ length: n }, (_, i) => s.bits[i] ?? 0))
                  }}
                />
              </div>
              <div className="w-28">
                <Input size="small" aria-label="Rate" suffix={<span className="text-[13px] text-gray-700">MHz</span>} defaultValue={String(s.rate / 1e6)} onBlur={(e) => { const v = parseSi(e.target.value); if (v && v > 0) s.set({ rate: v * 1e6 }) }} />
              </div>
            </div>
          </div>
          <div className="relative h-24 rounded-small bg-background-200 shadow-[0_0_0_1px_var(--gray-alpha-400)]" onPointerUp={() => (painting.current = null)} onPointerLeave={() => (painting.current = null)}>
            <div role="group" aria-label={`Custom pattern editor, ${s.bits.length} samples`} className="absolute inset-0 flex gap-0.5 p-2">
              {s.bits.map((b, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Sample ${i + 1}`}
                  aria-pressed={!!b}
                  className="relative flex-1 rounded-[2px] hover:bg-gray-alpha-200"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    painting.current = b ? 0 : 1
                    setBits(s.bits.map((x, k) => (k === i ? (b ? 0 : 1) : x)))
                  }}
                  onPointerEnter={() => painting.current !== null && paint(i, painting.current)}
                >
                  <span className={`absolute inset-x-0 bottom-0 rounded-[2px] ${b ? 'top-0 bg-green-700' : 'h-1 bg-gray-alpha-400'}`} />
                </button>
              ))}
            </div>
          </div>
          <span className="text-[13px] leading-4 text-gray-900">
            Click a sample to toggle it, or drag with the mouse held down to paint. {s.bits.filter(Boolean).length} of {s.bits.length} high, {si(s.bits.length / s.rate, 's')} per cycle.
          </span>
        </Material>
      )}
      <Note type="secondary" size="small">
        Pins driven by Static I/O outputs take priority over Patterns.
      </Note>
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </ScrollPage>
  )
}
