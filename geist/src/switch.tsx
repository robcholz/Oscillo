// Geist Switch (https://vercel.com/geist/switch): 2–4 mutually exclusive views.
import { cn } from './cn'

export interface SwitchProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly (T | { value: T; label: string })[]
  'aria-label': string
  fill?: boolean
  className?: string
}

export function Switch<T extends string>({ value, onChange, options, fill, className, ...rest }: SwitchProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={rest['aria-label']}
      className={cn('flex rounded-small bg-background-100 p-1 shadow-[0_0_0_1px_var(--gray-alpha-400)]', className)}
    >
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o
        const on = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(opt.value)}
            className={cn(
              'h-6 cursor-pointer rounded-kbd px-3 text-sm font-medium transition-colors',
              fill && 'flex-1',
              on ? 'bg-gray-100 text-gray-1000' : 'text-gray-900 hover:text-gray-1000'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
