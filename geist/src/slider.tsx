// Geist Slider (https://vercel.com/geist/slider): a 4px track, filled to the value, with a 16px thumb.
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label?: ReactNode
  /** Shown at the right of the label row, e.g. the formatted value. */
  valueLabel?: ReactNode
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, valueLabel, disabled, className, ...rest }: SliderProps) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100
  return (
    <div className={cn('flex flex-col gap-2', disabled && 'opacity-60', className)}>
      {(label || valueLabel != null) && (
        <div className="flex items-center justify-between">
          <span className="text-[13px] leading-4 text-gray-900">{label}</span>
          {valueLabel != null && <span className="text-[13px] leading-4 tabular-nums text-gray-1000">{valueLabel}</span>}
        </div>
      )}
      <div className="relative h-5">
        <span className="absolute inset-x-0 top-2 h-1 rounded-full bg-gray-alpha-400" />
        <span className="absolute left-0 top-2 h-1 rounded-full bg-gray-1000" style={{ width: pct + '%' }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={rest['aria-label'] ?? (typeof label === 'string' ? label : undefined)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          className="pointer-events-none absolute top-0.5 -ml-2 size-4 rounded-full bg-[#fff] shadow-[0_0_0_1px_var(--gray-alpha-500),0_1px_2px_rgb(0_0_0/0.16)] peer-focus-visible:shadow-focus-ring"
          style={{ left: pct + '%' }}
        />
      </div>
    </div>
  )
}
