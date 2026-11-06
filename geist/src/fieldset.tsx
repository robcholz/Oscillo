// Geist Fieldset (https://vercel.com/geist/fieldset): a titled card with an optional footer.
import type { ReactNode } from 'react'
import { cn } from './cn'
import { CircleAlertGlyph, TriangleAlertGlyph } from './icons'

export interface FieldsetProps {
  title?: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
  /** Text on the left of the footer. */
  footer?: ReactNode
  /** Buttons on the right of the footer. */
  actions?: ReactNode
  type?: 'default' | 'warning' | 'error'
  /** Heading size: 20 for page sections (Geist default), 16 for cards inside a page. */
  titleSize?: 16 | 20
  className?: string
  bodyClassName?: string
}

export function Fieldset({ title, subtitle, children, footer, actions, type = 'default', titleSize = 20, className, bodyClassName }: FieldsetProps) {
  const tinted = type !== 'default'
  return (
    <section
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn(
        'overflow-hidden rounded-small',
        type === 'warning'
          ? 'bg-amber-100 shadow-[0_0_0_1px_var(--amber-400)]'
          : type === 'error'
            ? 'bg-red-100 shadow-[0_0_0_1px_var(--red-400)]'
            : 'bg-background-100 shadow-[0_0_0_1px_var(--gray-alpha-400)]',
        className
      )}
    >
      <div className={cn('flex flex-col gap-3 p-6', bodyClassName)}>
        {title && (
          <h3
            className={cn(
              'm-0 flex items-center gap-2 font-semibold',
              titleSize === 20 ? 'text-xl leading-[26px] tracking-[-0.4px]' : 'text-base leading-6 tracking-[-0.32px]',
              type === 'warning' && 'text-amber-900',
              type === 'error' && 'text-red-900'
            )}
          >
            {type === 'warning' && <TriangleAlertGlyph size={20} />}
            {type === 'error' && <CircleAlertGlyph size={20} />}
            {title}
          </h3>
        )}
        {subtitle && <p className="m-0 text-sm text-gray-900">{subtitle}</p>}
        {children}
      </div>
      {(footer || actions) && (
        <div
          className={cn(
            'flex min-h-14 items-center justify-between gap-3 px-6 py-3 text-sm text-gray-900',
            tinted
              ? type === 'warning'
                ? 'shadow-[inset_0_1px_0_var(--amber-400)]'
                : 'shadow-[inset_0_1px_0_var(--red-400)]'
              : 'bg-background-200 shadow-[inset_0_1px_0_var(--gray-alpha-400)]'
          )}
        >
          <span className="min-w-0">{footer}</span>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
    </section>
  )
}
