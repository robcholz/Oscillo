// Static I/O (board: StaticIO). DIO 7–0 as per-bit LEDs, buttons and switches; DIO 15–8 as an 8-bit
// output shown as a slider, progress bar, bits or 7-segment digits.
import { Button, Description, Material, Note, Progress, Select, Slider, StatusDot, Toggle } from '@robcholz/geist'
import { CircleDot, Minus, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PageBar, ScrollPage } from '../components/Page'
import { useInterval } from '../components/useInterval'
import { follow, isHardware, pushDio, useHwLive } from '../hwsync'
import { useStore } from '../store'

type Widget = 'LED' | 'Button' | 'Switch'
const MODES = ['Bit I/O', 'Slider', 'Progress Bar', '7-Segment'] as const
type Mode = (typeof MODES)[number]

interface IOState {
  widgets: Widget[]
  switches: boolean[]
  drive: string
  loMode: Mode
  hiMode: Mode
  hi: number
  /** The DIO button held down, if any. */
  pressed: number | null
  set: (p: Partial<Omit<IOState, 'set'>>) => void
}

const initial = { widgets: ['LED', 'LED', 'LED', 'LED', 'Button', 'Button', 'Switch', 'Switch'] as Widget[], switches: Array(8).fill(false) as boolean[], drive: 'Push-Pull', loMode: 'Bit I/O' as Mode, hiMode: 'Slider' as Mode, hi: 0x5a }
const useIO = create<IOState>()(persist((set) => ({ ...initial, pressed: null, set: (p) => set(p) }), { name: 'oscillo.static-io', partialize: ({ set: _s, pressed: _p, ...r }) => r }))

/** Output enables and levels: DIO 15–8 always drive; DIO 7–0 drive where the widget is a switch or button. */
function outputs(s: IOState): { mask: number; value: number } {
  let mask = 0xff00
  let value = (s.hi & 0xff) << 8
  s.widgets.forEach((w, i) => {
    if (w === 'LED') return
    mask |= 1 << i
    if (w === 'Switch' ? s.switches[i] : s.pressed === i) value |= 1 << i
  })
  return { mask, value }
}

// Real hardware follows the switches, buttons and the DIO 15–8 value.
follow([useIO], () => outputs(useIO.getState()), ({ mask, value }) => pushDio(mask, value), 'Static I/O')

// Segments a–g as [left, top, width, height] in a 36 × 60 cell.
const SEG: [number, number, number, number][] = [
  [6, 0, 24, 5],
  [31, 5, 5, 23],
  [31, 32, 5, 23],
  [6, 55, 24, 5],
  [0, 32, 5, 23],
  [0, 5, 5, 23],
  [6, 27.5, 24, 5]
]
const GLYPH: Record<string, number> = { 0: 0x3f, 1: 0x06, 2: 0x5b, 3: 0x4f, 4: 0x66, 5: 0x6d, 6: 0x7d, 7: 0x07, 8: 0x7f, 9: 0x6f, A: 0x77, B: 0x7c, C: 0x39, D: 0x5e, E: 0x79, F: 0x71 }

function SevenSeg({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex gap-1" role="img" aria-label={label}>
      {[...text].map((ch, i) => (
        <div key={i} className="relative h-[60px] w-9">
          {SEG.map(([l, t, w, h], k) => (
            <span key={k} className={`absolute rounded-[2px] ${(GLYPH[ch] >> k) & 1 ? 'bg-red-800' : 'bg-gray-alpha-200'}`} style={{ left: l, top: t, width: w, height: h }} />
          ))}
        </div>
      ))}
    </div>
  )
}

const hex2 = (v: number) => v.toString(16).toUpperCase().padStart(2, '0')

export function StaticIO() {
  const s = useIO()
  const app = useStore()
  const live = app.running && !!app.device
  const pressed = s.pressed
  const setPressed = (pressed: number | null) => s.set({ pressed })
  const dio = useHwLive((h) => h.dio)
  const real = isHardware()
  const [t, setT] = useState(0)
  useInterval(() => setT((x) => x + 1), 250, live)

  // Inputs: the device's pin levels on real hardware; on the Demo Device, a slow counter.
  const inputs = real ? (dio ?? 0) & 0xff : (t >> 2) & 0xff
  const level = (i: number) => {
    const w = s.widgets[i]
    if (w === 'LED') return live ? (inputs >> i) & 1 : 0
    if (w === 'Button') return pressed === i ? 1 : 0
    return s.switches[i] ? 1 : 0
  }
  const lo = Array.from({ length: 8 }, (_, i) => level(i)).reduce((a, b, i) => a | (b << i), 0)

  const step = (d: number) => s.set({ hi: Math.max(0, Math.min(255, s.hi + d)) })
  const modeSelect = (label: string, value: Mode, on: (m: Mode) => void) => (
    <div className="w-[144px]">
      <Select size="small" aria-label={label} value={value} options={MODES} onValueChange={(v) => on(v as Mode)} />
    </div>
  )
  const stepper = (
    <div className="flex gap-2">
      <Button size="small" type="tertiary" prefix={<Minus size={16} />} disabled={s.hi === 0} onClick={() => step(-1)}>
        Step Down
      </Button>
      <Button size="small" type="tertiary" prefix={<Plus size={16} />} disabled={s.hi === 255} onClick={() => step(1)}>
        Step Up
      </Button>
    </div>
  )

  return (
    <ScrollPage
      className="flex flex-col gap-4"
      bar={
        <PageBar title="Static I/O" status={<StatusDot state={live ? 'READY' : 'QUEUED'} label={live ? 'Live' : 'Stopped'} />}>
          <Button
            size="small"
            type="secondary"
            prefix={<RefreshCw size={16} />}
            onClick={() => {
              s.set({ switches: Array(8).fill(false), hi: 0 })
              app.toast('All outputs reset to low')
            }}
          >
            Reset All
          </Button>
        </PageBar>
      }
    >
      <Material className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">DIO 7–0</h2>
            <p className="mt-0.5 text-[13px] leading-4 text-gray-900">Mixed inputs and outputs, set per bit</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-[120px]">
              <Select size="small" aria-label="Output Drive" value={s.drive} options={['Push-Pull', 'Open-Drain']} onValueChange={(drive) => s.set({ drive })} />
            </div>
            {modeSelect('DIO 7–0 Display', s.loMode, (loMode) => s.set({ loMode }))}
          </div>
        </div>
        {s.loMode === 'Bit I/O' && (
          <div className="flex flex-wrap justify-between gap-2">
            {Array.from({ length: 8 }, (_, k) => 7 - k).map((i) => {
              const w = s.widgets[i]
              const on = level(i)
              return (
                <div key={i} className="flex min-w-12 flex-col items-center gap-1.5">
                  <div className="flex h-8 items-center">
                    {w === 'LED' && (
                      <span
                        role="img"
                        aria-label={`DIO ${i} input ${on ? 'high' : 'low'}`}
                        className={`size-5 rounded-full transition-colors duration-100 ${on ? 'bg-green-700 shadow-[0_0_10px_var(--green-700)]' : 'bg-gray-alpha-300 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]'}`}
                      />
                    )}
                    {w === 'Button' && (
                      <Button
                        type={pressed === i ? 'primary' : 'secondary'}
                        size="small"
                        svgOnly
                        aria-label={`Press DIO ${i}`}
                        tooltip
                        onPointerDown={() => setPressed(i)}
                        onPointerUp={() => setPressed(null)}
                        onPointerLeave={() => pressed === i && setPressed(null)}
                      >
                        <CircleDot size={16} />
                      </Button>
                    )}
                    {w === 'Switch' && <Toggle checked={s.switches[i]} aria-label={`DIO ${i} switch`} onChange={(v) => s.set({ switches: s.switches.map((x, k) => (k === i ? v : x)) })} />}
                  </div>
                  <span className="font-mono text-xs text-gray-900">{i}</span>
                  <div className="w-[92px]">
                    <Select size="small" aria-label={`DIO ${i} widget`} value={w} options={['LED', 'Button', 'Switch']} onValueChange={(v) => s.set({ widgets: s.widgets.map((x, k) => (k === i ? (v as Widget) : x)) })} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {s.loMode === 'Slider' && <Slider label="DIO 7–0 Value" min={0} max={255} value={lo} onChange={() => app.toast('DIO 7–0 has inputs', { detail: 'Set every bit to Switch to drive the group as a value.' })} />}
        {s.loMode === 'Progress Bar' && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] tabular-nums text-gray-900">
              {lo} of 255 · 0x{hex2(lo)}
            </span>
            <Progress value={lo} max={255} aria-label="DIO 7–0 level" />
          </div>
        )}
        {s.loMode === '7-Segment' && <SevenSeg text={hex2(lo)} label={`0x${hex2(lo)}`} />}
      </Material>

      <Material className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">DIO 15–8</h2>
            <p className="mt-0.5 text-[13px] leading-4 text-gray-900">8-bit output, 0 to 255</p>
          </div>
          {modeSelect('DIO 15–8 Display', s.hiMode, (hiMode) => s.set({ hiMode }))}
        </div>
        {s.hiMode === 'Slider' && <Slider label="Output Value" min={0} max={255} value={s.hi} onChange={(hi) => s.set({ hi })} />}
        {s.hiMode === 'Bit I/O' && (
          <div className="flex flex-wrap justify-between gap-2">
            {Array.from({ length: 8 }, (_, k) => 7 - k).map((b) => (
              <div key={b} className="flex min-w-10 flex-col items-center gap-1.5">
                <Toggle checked={!!((s.hi >> b) & 1)} aria-label={`DIO ${b + 8}`} onChange={(on) => s.set({ hi: on ? s.hi | (1 << b) : s.hi & ~(1 << b) })} />
                <span className="font-mono text-xs text-gray-900">{b + 8}</span>
              </div>
            ))}
          </div>
        )}
        {s.hiMode === 'Progress Bar' && (
          <div className="flex flex-col gap-2">
            <Progress value={s.hi} max={255} aria-label="DIO 15–8 level" />
            {stepper}
          </div>
        )}
        {s.hiMode === '7-Segment' && (
          <div className="flex flex-col gap-2">
            <SevenSeg text={hex2(s.hi)} label={`0x${hex2(s.hi)}`} />
            {stepper}
          </div>
        )}
        <div className="flex gap-8">
          <Description title="Hex" content={'0x' + hex2(s.hi)} mono />
          <Description title="Binary" content={s.hi.toString(2).padStart(8, '0')} mono />
          <Description title="Decimal" content={String(s.hi)} mono />
        </div>
      </Material>

      <Material className="flex min-w-0 flex-col gap-3 p-4">
        <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">Group Display Modes</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(max(220px,calc(33.333%-16px)),1fr))] gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs text-gray-900">Slider</span>
            <Slider aria-label="Slider preview" min={0} max={255} value={s.hi} onChange={(hi) => s.set({ hi })} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-gray-900">Progress Bar</span>
            <Progress value={s.hi} max={255} aria-label="Progress preview" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-gray-900">7-Segment</span>
            <SevenSeg text={String(s.hi).padStart(3, '0')} label={String(s.hi)} />
          </div>
        </div>
      </Material>
      <Note type="secondary" size="small">
        Analog Discovery 3 has 16 digital I/O pins. Pins used by Patterns, Logic or Protocol show as Busy here.
      </Note>
    </ScrollPage>
  )
}
