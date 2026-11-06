// Geist Gauge (https://vercel.com/geist/gauge): a ring split into the value and the rest, with a small
// gap between them, and the value in the middle. `shape="arc"` draws the half-circle dial instead.
import type { ReactNode } from 'react'

export interface GaugeProps {
  /** 0–100 */
  value: number
  label: string
  size?: 'tiny' | 'small' | 'medium' | 'large'
  showValue?: boolean
  /** Colour by threshold, e.g. { 0: 'var(--gray-1000)', 80: 'var(--amber-700)', 95: 'var(--red-800)' }. */
  colors?: Record<number, string>
  shape?: 'circle' | 'arc'
  children?: ReactNode
}

const px = { tiny: 20, small: 32, medium: 64, large: 128 }
const font = { tiny: 0, small: 11, medium: 18, large: 32 }

function colorFor(v: number, colors?: Record<number, string>): string {
  if (!colors) return 'var(--gray-1000)'
  let c = 'var(--gray-1000)'
  for (const k of Object.keys(colors).map(Number).sort((a, b) => a - b)) if (v >= k) c = colors[k]
  return c
}

export function Gauge({ value, label, size = 'medium', showValue, colors, shape = 'circle', children }: GaugeProps) {
  const v = Math.max(0, Math.min(100, value))
  if (shape === 'arc')
    return (
      <div className="relative flex justify-center pt-3">
        <svg viewBox="0 0 200 116" className="w-full max-w-[230px]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
          <path d="M 16 108 A 84 84 0 0 1 184 108" fill="none" stroke="var(--gray-200)" strokeWidth="10" strokeLinecap="round" pathLength={100} />
          <path d="M 16 108 A 84 84 0 0 1 184 108" fill="none" stroke={colorFor(v, colors)} strokeWidth="10" strokeLinecap="round" pathLength={100} strokeDasharray={`${v} 100`} />
        </svg>
        <div className="absolute bottom-0 flex flex-col items-center">{children}</div>
      </div>
    )
  const d = px[size]
  const sw = Math.max(2, d * 0.1)
  const r = (d - sw) / 2
  const circ = 2 * Math.PI * r
  const gap = v > 0 && v < 100 ? Math.min(circ * 0.03, sw * 1.2) + sw : 0
  const on = (v / 100) * circ
  return (
    <div className="relative inline-flex flex-none items-center justify-center" style={{ width: d, height: d }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
      <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`} className="-rotate-90">
        {v < 100 && (
          <circle
            cx={d / 2}
            cy={d / 2}
            r={r}
            fill="none"
            stroke="var(--gray-alpha-400)"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0, circ - on - gap * 2 + (v === 0 ? gap * 2 : 0))} ${circ}`}
            strokeDashoffset={-(on + (v > 0 ? gap : 0))}
          />
        )}
        {v > 0 && <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke={colorFor(v, colors)} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${on} ${circ}`} />}
      </svg>
      {showValue && size !== 'tiny' && (
        <span className="absolute font-semibold tabular-nums text-gray-1000" style={{ fontSize: font[size], letterSpacing: size === 'large' ? -1.28 : 0 }}>
          {Math.round(v)}
        </span>
      )}
      {children && <span className="absolute">{children}</span>}
    </div>
  )
}
