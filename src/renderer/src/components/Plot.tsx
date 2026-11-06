// A measurement plot: 10 × 10 division grid, line, step or bar series in real units, Y labels at the
// right, X ticks below, and a hover probe that reads every visible series under the pointer.
import { cn } from '@robcholz/geist'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { axisTicks, si, tick } from './format'

export interface Series {
  id: string
  name: string
  color: string
  /** Sample x values (ascending) and y values. */
  x: ArrayLike<number>
  y: ArrayLike<number>
  kind?: 'line' | 'step' | 'bars'
  dashed?: boolean
  width?: number
  opacity?: number
  hidden?: boolean
  unit?: string
  /** Draw on a separate y range, e.g. phase on a gain plot. */
  yRange?: [number, number]
}

export interface Axis {
  min: number
  max: number
  unit: string
  /** Number of grid divisions. */
  divisions?: number
  log?: boolean
  /** Label for the probe readout ("t" for time). */
  label?: string
  format?: (v: number) => string
}

export interface PlotProps {
  x: Axis
  y: Axis
  series: Series[]
  /** CSS height; grows with the window like the design (380px at 900px tall). */
  height?: string
  probe?: 'x' | 'nearest' | 'none'
  ariaLabel: string
  /** Overlays positioned in plot fractions: children get (fx, fy) helpers. */
  overlay?: (toPct: (x: number, y: number) => { left: string; top: string }) => ReactNode
  /** Extra Y labels on the left (second axis). */
  y2?: Axis
  className?: string
  onClick?: (x: number, y: number) => void
}

const W = 1000
const H = 500

function toFrac(v: number, a: Axis): number {
  if (a.log) return (Math.log10(v) - Math.log10(a.min)) / (Math.log10(a.max) - Math.log10(a.min))
  return (v - a.min) / (a.max - a.min)
}
function fromFrac(f: number, a: Axis): number {
  if (a.log) return 10 ** (Math.log10(a.min) + f * (Math.log10(a.max) - Math.log10(a.min)))
  return a.min + f * (a.max - a.min)
}

function seriesPath(s: Series, xa: Axis, ya: Axis): string {
  const yr = s.yRange ? { ...ya, min: s.yRange[0], max: s.yRange[1], log: false } : ya
  const n = Math.min(s.x.length, s.y.length)
  if (n === 0) return ''
  // Plot at most ~2 points per horizontal unit.
  const step = Math.max(1, Math.floor(n / 2000))
  let d = ''
  let prevY = 0
  for (let i = 0; i < n; i += step) {
    const px = (toFrac(s.x[i], xa) * W).toFixed(1)
    const py = ((1 - toFrac(s.y[i], yr)) * H).toFixed(1)
    if (i === 0) d += `M${px},${py}`
    else if (s.kind === 'step') d += `H${px}V${py}`
    else d += `L${px},${py}`
    prevY = +py
  }
  void prevY
  return d
}

function lookup(s: Series, xv: number): { y: number; x: number } | null {
  const n = Math.min(s.x.length, s.y.length)
  if (!n) return null
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s.x[mid] < xv) lo = mid
    else hi = mid
  }
  if (s.kind === 'step') return { x: s.x[lo], y: s.y[xv >= s.x[hi] ? hi : lo] }
  const i = Math.abs(s.x[lo] - xv) < Math.abs(s.x[hi] - xv) ? lo : hi
  if (s.kind === 'bars') return { x: s.x[i], y: s.y[i] }
  const x0 = s.x[lo]
  const x1 = s.x[hi]
  const t = x1 === x0 ? 0 : Math.max(0, Math.min(1, (xv - x0) / (x1 - x0)))
  return { x: xv, y: s.y[lo] + (s.y[hi] - s.y[lo]) * t }
}

export function Plot({ x, y, series, height = 'calc(380px + max(0px, (100vh - 900px) * 0.75))', probe = 'x', ariaLabel, overlay, y2, className, onClick }: PlotProps) {
  const host = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ fx: number; fy: number; w: number; h: number } | null>(null)
  const xd = x.divisions ?? 10
  const yd = y.divisions ?? 10
  const visible = series.filter((s) => !s.hidden)
  const paths = useMemo(() => visible.map((s) => (s.kind === 'bars' ? null : seriesPath(s, x, y))), [visible, x, y])

  const yLabels = Array.from({ length: yd + 1 }, (_, i) => {
    const v = y.max - (i / yd) * (y.max - y.min)
    return { pct: (i / yd) * 100, text: y.format ? y.format(v) : tick(v, y.unit, i === 0 || i === yd), edge: i === 0 ? 'top' : i === yd ? 'bottom' : 'mid' }
  })
  const xn = xd > 5 ? 5 : xd
  const xVals = Array.from({ length: xn + 1 }, (_, i) => fromFrac(i / xn, x))
  const xTicks = x.format ? xVals.map(x.format) : x.log ? xVals.map((v, i) => tick(v, x.unit, i === 0 || i === xn)) : axisTicks(xVals, x.unit)

  const readout = (() => {
    if (!hover || probe === 'none') return null
    const xv = fromFrac(hover.fx, x)
    if (probe === 'nearest') {
      // XY plots: the sample closest to the pointer, in both axes.
      let best: { s: Series; i: number; d: number } | null = null
      for (const s of visible) {
        const n = Math.min(s.x.length, s.y.length)
        for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 1500))) {
          const dx = (toFrac(s.x[i], x) - hover.fx) * hover.w
          const dy = (1 - toFrac(s.y[i], y) - hover.fy) * hover.h
          const d = dx * dx + dy * dy
          if (!best || d < best.d) best = { s, i, d }
        }
      }
      if (!best) return null
      const px = best.s.x[best.i]
      const py = best.s.y[best.i]
      return { head: `${x.label ?? 'X'} = ${si(px, x.unit)}`, rows: [{ name: y.label ?? 'Y', color: best.s.color, v: si(py, y.unit) }], dot: { fx: toFrac(px, x), fy: 1 - toFrac(py, y) } }
    }
    const rows = visible
      .map((s) => {
        const r = lookup(s, xv)
        return r && { name: s.name, color: s.color, v: si(r.y, s.unit ?? y.unit), yv: r.y }
      })
      .filter(Boolean) as { name: string; color: string; v: string; yv: number }[]
    rows.sort((a, b) => b.yv - a.yv)
    return { head: `${x.label ?? 't'} = ${x.format ? x.format(xv) : si(xv, x.unit)}`, rows, dot: null }
  })()

  const toPct = (xv: number, yv: number) => ({ left: toFrac(xv, x) * 100 + '%', top: (1 - toFrac(yv, y)) * 100 + '%' })

  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-1.5', className)}>
      <div
        ref={host}
        style={{ height }}
        className={cn('relative overflow-hidden rounded-small bg-background-100 shadow-[0_0_0_1px_var(--gray-alpha-400)]', probe !== 'none' && 'cursor-crosshair')}
        onPointerMove={(e) => {
          const r = host.current!.getBoundingClientRect()
          setHover({ fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, w: r.width, h: r.height })
        }}
        onPointerLeave={() => setHover(null)}
        onClick={onClick && hover ? () => onClick(fromFrac(hover.fx, x), fromFrac(1 - hover.fy, y)) : undefined}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} className="absolute inset-0 size-full">
          {Array.from({ length: xd - 1 }, (_, i) => {
            const px = ((i + 1) / xd) * W
            return <line key={'x' + i} x1={px} x2={px} y1={0} y2={H} stroke={i + 1 === xd / 2 ? 'var(--gray-alpha-400)' : 'var(--gray-alpha-200)'} vectorEffect="non-scaling-stroke" />
          })}
          {Array.from({ length: yd - 1 }, (_, i) => {
            const py = ((i + 1) / yd) * H
            return <line key={'y' + i} y1={py} y2={py} x1={0} x2={W} stroke={i + 1 === yd / 2 ? 'var(--gray-alpha-400)' : 'var(--gray-alpha-200)'} vectorEffect="non-scaling-stroke" />
          })}
          {visible.map((s, k) =>
            s.kind === 'bars' ? (
              <g key={s.id} fill={s.color} fillOpacity={s.opacity ?? 0.9}>
                {Array.from({ length: Math.min(s.x.length, s.y.length) }, (_, i) => {
                  const n = s.x.length
                  const bw = Math.max(2, (W / n) * 0.7)
                  const px = toFrac(s.x[i], x) * W
                  const py = (1 - Math.max(0, Math.min(1, toFrac(s.y[i], y)))) * H
                  return <rect key={i} x={px - bw / 2} y={py} width={bw} height={H - py} />
                })}
              </g>
            ) : (
              <path
                key={s.id}
                d={paths[k] ?? ''}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width ?? 1.5}
                strokeOpacity={s.opacity ?? 1}
                strokeDasharray={s.dashed ? '4 4' : undefined}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            )
          )}
        </svg>
        {overlay ? overlay(toPct) : null}
        {yLabels.map((l, i) => (
          <span
            key={i}
            aria-hidden="true"
            style={{ top: l.pct + '%' }}
            className={cn(
              'pointer-events-none absolute right-1.5 text-xs tabular-nums text-gray-900',
              l.edge === 'mid' ? '-translate-y-1/2' : l.edge === 'bottom' ? '-translate-y-full' : ''
            )}
          >
            {l.text}
          </span>
        ))}
        {y2 &&
          Array.from({ length: (y2.divisions ?? yd) + 1 }, (_, i) => {
            const n = y2.divisions ?? yd
            const v = y2.max - (i / n) * (y2.max - y2.min)
            return (
              <span
                key={'l' + i}
                aria-hidden="true"
                style={{ top: (i / n) * 100 + '%' }}
                className={cn('pointer-events-none absolute left-1.5 text-xs tabular-nums text-gray-900', i === 0 ? '' : i === n ? '-translate-y-full' : '-translate-y-1/2')}
              >
                {y2.format ? y2.format(v) : tick(v, y2.unit, i === 0 || i === n)}
              </span>
            )
          })}
        {hover && readout && (
          <>
            {probe === 'x' && <span className="pointer-events-none absolute inset-y-0 z-[5] w-0 border-l border-dashed border-gray-900" style={{ left: hover.fx * 100 + '%' }} />}
            {readout.dot && (
              <span
                className="pointer-events-none absolute z-[6] -ml-1 -mt-1 size-2 rounded-full shadow-[0_0_0_2px_var(--background-100)]"
                style={{ left: readout.dot.fx * 100 + '%', top: readout.dot.fy * 100 + '%', background: readout.rows[0]?.color }}
              />
            )}
            <div
              className="pointer-events-none absolute z-[6] flex min-w-[132px] flex-col gap-0.5 whitespace-nowrap rounded-small bg-background-100 px-2 py-1.5 text-xs tabular-nums text-gray-1000 shadow-menu"
              style={{
                left: hover.fx > 0.7 ? undefined : `calc(${hover.fx * 100}% + 12px)`,
                right: hover.fx > 0.7 ? `calc(${(1 - hover.fx) * 100}% + 12px)` : undefined,
                top: `clamp(4px, calc(${hover.fy * 100}% - 20px), calc(100% - ${20 + readout.rows.length * 18}px))`
              }}
            >
              <span className="mb-0.5 pb-[3px] text-gray-900 shadow-[inset_0_-1px_0_var(--gray-alpha-300)]">{readout.head}</span>
              {readout.rows.map((r) => (
                <span key={r.name} className="flex items-center gap-1.5">
                  <i className="h-0.5 w-2 flex-none rounded-[1px]" style={{ background: r.color }} />
                  <span className="text-gray-900">{r.name}</span>
                  <b className="ml-auto pl-3 font-mono font-medium">{r.v}</b>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div aria-hidden="true" className="flex justify-between text-xs tabular-nums text-gray-900">
        {xTicks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </figure>
  )
}
