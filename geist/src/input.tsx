// Geist Input and Search Input (https://vercel.com/geist/input).
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'
import { ErrorMessage, errorRing } from './error-message'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: 'small' | 'medium' | 'large'
  prefix?: ReactNode
  suffix?: ReactNode
  /** Visually hidden label for inputs without a visible one. */
  label?: string
  mono?: boolean
  wrapperClassName?: string
  /** Geist `error`: a message shows it under the field; true only sets the red ring (message shown elsewhere). */
  error?: string | boolean
}

const heights = { small: 'h-8', medium: 'h-9', large: 'h-10' }

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'medium', prefix, suffix, label, mono, wrapperClassName, className, error, ...rest },
  ref
) {
  const errorId = useId()
  const field = (
    <label
      className={cn(
        'flex items-center gap-2 rounded-small bg-background-100 px-3 text-sm text-gray-1000',
        'transition-shadow',
        error
          ? errorRing
          : 'shadow-[0_0_0_1px_var(--gray-alpha-400)] hover:shadow-[0_0_0_1px_var(--gray-alpha-500)] focus-within:shadow-focus-border focus-within:hover:shadow-focus-border',
        heights[size],
        wrapperClassName
      )}
    >
      {label && <span className="sr-only">{label}</span>}
      {prefix && <span className="flex text-gray-700">{prefix}</span>}
      <input
        ref={ref}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          'h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-inherit outline-none placeholder:text-gray-700 focus-visible:shadow-none disabled:placeholder:text-gray-500',
          mono && 'font-mono text-[13px]',
          className
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={typeof error === 'string' && error ? errorId : undefined}
        {...rest}
      />
      {suffix}
    </label>
  )
  if (typeof error !== 'string' || !error) return field
  return (
    <div className="flex flex-col gap-2">
      {field}
      <ErrorMessage id={errorId}>{error}</ErrorMessage>
    </div>
  )
})

export function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  )
}
