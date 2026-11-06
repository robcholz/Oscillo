// Geist Radio (https://vercel.com/geist/radio) and Choicebox (https://vercel.com/geist/choicebox).
import { useId, type ReactNode } from 'react'
import { cn } from './cn'

export interface RadioOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

function Dot({ on, blue }: { on: boolean; blue?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-radio-dot=""
      className={cn(
        'relative size-4 flex-none rounded-full bg-background-100',
        on ? (blue ? 'shadow-[inset_0_0_0_1px_var(--blue-700)]' : 'shadow-[inset_0_0_0_1px_var(--gray-1000)]') : 'shadow-[inset_0_0_0_1px_var(--gray-alpha-700)]',
        'peer-focus-visible:shadow-focus-ring'
      )}
    >
      {on && <span className={cn('absolute inset-1 rounded-full', blue ? 'bg-blue-700' : 'bg-gray-1000')} />}
    </span>
  )
}

export interface RadioGroupProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly RadioOption<T>[]
  'aria-label': string
  horizontal?: boolean
  className?: string
}

export function RadioGroup<T extends string>({ value, onChange, options, horizontal, className, ...rest }: RadioGroupProps<T>) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={rest['aria-label']} className={cn('flex', horizontal ? 'flex-row flex-wrap gap-6' : 'flex-col gap-3', className)}>
      {options.map((o) => (
        <label key={o.value} className={cn('relative inline-flex cursor-pointer items-center gap-2 text-sm text-gray-1000', o.disabled && 'cursor-not-allowed opacity-60')}>
          <input type="radio" className="peer sr-only" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
          <Dot on={value === o.value} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}

export interface ChoiceboxGroupProps<T extends string> extends RadioGroupProps<T> {
  columns?: number
}

export function ChoiceboxGroup<T extends string>({ value, onChange, options, columns = 2, className, ...rest }: ChoiceboxGroupProps<T>) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={rest['aria-label']} className={cn('grid gap-2', className)} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = value === o.value
        return (
          <label
            key={o.value}
            className={cn(
              'relative flex cursor-pointer items-start justify-between gap-3 rounded-small p-3',
              on ? 'bg-blue-100 shadow-[inset_0_0_0_1px_var(--blue-600)]' : 'bg-background-100 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)] hover:bg-gray-alpha-100',
              o.disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            <span className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-1000">{o.label}</span>
              {o.description && <span className="text-[13px] leading-[18px] text-gray-900">{o.description}</span>}
            </span>
            <input type="radio" className="peer sr-only" name={name} value={o.value} checked={on} disabled={o.disabled} onChange={() => onChange(o.value)} />
            <Dot on={on} blue />
          </label>
        )
      })}
    </div>
  )
}
