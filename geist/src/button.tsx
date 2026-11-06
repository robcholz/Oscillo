// Geist Button, rebuilt to match the props of `@vercel/geistcn` Button
// (https://vercel.com/geist/button) and its measured dark-theme styles.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'
import { Spinner } from './spinner'
import { Tooltip } from './tooltip'

export type ButtonType = 'primary' | 'secondary' | 'tertiary' | 'error' | 'warning'
export type ButtonSize = 'small' | 'medium' | 'large'

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'prefix'> {
  /** Visual variant. Defaults to primary. */
  type?: ButtonType
  /** The HTML button type (Geist keeps it off `type`). */
  typeName?: 'button' | 'submit' | 'reset'
  size?: ButtonSize
  shape?: 'square' | 'circle' | 'rounded'
  prefix?: ReactNode
  suffix?: ReactNode
  loading?: boolean
  /** Icon-only button; pass an aria-label. */
  svgOnly?: boolean
  shadow?: boolean
  /** A tooltip; `true` uses the aria-label (the usual choice for icon-only buttons). */
  tooltip?: ReactNode | true
  tooltipKeys?: string[]
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right'
}

const sizeClass: Record<ButtonSize, string> = {
  small: 'h-8 px-1.5 text-sm rounded-small',
  medium: 'h-9 px-2.5 text-sm rounded-small',
  large: 'h-10 px-3.5 text-base rounded-[8px]'
}

const iconOnlySize: Record<ButtonSize, string> = {
  small: 'w-8 px-0',
  medium: 'w-9 px-0',
  large: 'w-10 px-0'
}

const typeClass: Record<ButtonType, string> = {
  primary: 'bg-gray-1000 text-background-100 hover:bg-[var(--button-primary-hover)]',
  secondary:
    'bg-background-100 text-gray-1000 shadow-[0_0_0_1px_var(--gray-alpha-400)] hover:bg-gray-alpha-200',
  tertiary: 'bg-transparent text-gray-1000 hover:bg-gray-alpha-200',
  error: 'bg-red-800 text-[#fff] hover:bg-red-900',
  warning: 'bg-amber-800 text-[#0a0a0a] hover:bg-amber-900'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    type = 'primary',
    typeName = 'button',
    size = 'medium',
    shape,
    prefix,
    suffix,
    loading = false,
    svgOnly = false,
    shadow = false,
    tooltip,
    tooltipKeys,
    tooltipPosition,
    disabled,
    className,
    children,
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading
  const button = (
    <button
      ref={ref}
      type={typeName}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-geist-button=""
      className={cn(
        'relative inline-flex max-w-full shrink-0 cursor-pointer select-none items-center justify-center font-medium',
        'transition-[background-color,color,box-shadow] duration-150 ease-in-out [&_svg]:shrink-0',
        'kbd-focus:shadow-focus-ring kbd-focus:transition-none',
        sizeClass[size],
        svgOnly && iconOnlySize[size],
        shape === 'circle' && 'rounded-full',
        shape === 'rounded' && 'rounded-full',
        shadow && 'shadow-small',
        isDisabled
          ? 'cursor-not-allowed bg-gray-100 text-gray-700 shadow-[0_0_0_1px_var(--gray-alpha-200)]'
          : typeClass[type],
        className
      )}
      {...rest}
    >
      {loading ? (
        <span className="mr-1.5 inline-flex">
          <Spinner size={size === 'large' ? 16 : 14} />
        </span>
      ) : (
        prefix && <span className="inline-flex">{prefix}</span>
      )}
      {svgOnly ? children : <span className="truncate px-1.5">{children}</span>}
      {suffix && <span className="ml-auto inline-flex">{suffix}</span>}
    </button>
  )
  if (!tooltip) return button
  return (
    <Tooltip text={tooltip === true ? rest['aria-label'] : tooltip} keys={tooltipKeys} position={tooltipPosition}>
      {button}
    </Tooltip>
  )
})
