// Geist Checkbox (https://vercel.com/geist/checkbox).
import { useId, type ReactNode } from 'react'
import { cn } from './cn'
import { CheckGlyph, MinusGlyph } from './icons'

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  indeterminate?: boolean
  disabled?: boolean
  children?: ReactNode
  id?: string
  className?: string
  'aria-label'?: string
}

export function Checkbox({ checked, onChange, indeterminate, disabled, children, id, className, ...rest }: CheckboxProps) {
  const auto = useId()
  const on = checked || indeterminate
  return (
    <label htmlFor={id ?? auto} className={cn('relative inline-flex cursor-pointer items-center gap-2 text-sm text-gray-1000', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input
        id={id ?? auto}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={rest['aria-label']}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 flex-none items-center justify-center rounded-[4px] text-background-100',
          'peer-focus-visible:shadow-focus-ring',
          on ? 'bg-gray-1000' : 'bg-background-100 shadow-[inset_0_0_0_1px_var(--gray-alpha-700)]'
        )}
      >
        {indeterminate ? <MinusGlyph size={12} strokeWidth={2.5} /> : checked ? <CheckGlyph size={12} strokeWidth={2.5} /> : null}
      </span>
      {children != null && <span>{children}</span>}
    </label>
  )
}
