// Geist Progress (https://vercel.com/geist/progress).
import { cn } from './cn'

export interface ProgressProps {
  value: number
  max?: number
  type?: 'default' | 'success' | 'error' | 'warning'
  /** Colour by thresholds instead, e.g. { 0: 'var(--gray-1000)', 80: 'var(--amber-700)', 95: 'var(--red-800)' }. */
  colors?: Record<number, string>
  'aria-label'?: string
  className?: string
}

const fill = { default: 'bg-gray-1000', success: 'bg-blue-700', error: 'bg-red-800', warning: 'bg-amber-700' }

export function Progress({ value, max = 100, type = 'default', colors, className, ...rest }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  let color: string | undefined
  if (colors) for (const k of Object.keys(colors).map(Number).sort((a, b) => a - b)) if (pct >= k) color = colors[k]
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={rest['aria-label']}
      className={cn('relative h-2 overflow-hidden rounded-full bg-gray-alpha-200', className)}
    >
      <div className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-150', !color && fill[type])} style={{ width: pct + '%', background: color }} />
    </div>
  )
}
