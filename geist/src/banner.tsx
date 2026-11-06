// Geist Banner: a full-width strip at the top of a page.
import type { ReactNode } from 'react'
import { cn } from './cn'
import { Button } from './button'
import { XGlyph } from './icons'

export interface BannerProps {
  type?: 'default' | 'success' | 'warning' | 'error' | 'violet'
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  /** Shows a close button. */
  onClose?: () => void
}

const types = {
  default: 'bg-background-200 text-gray-1000 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]',
  success: 'bg-blue-100 text-blue-900 shadow-[inset_0_-1px_0_var(--blue-400)]',
  warning: 'bg-amber-100 text-amber-900 shadow-[inset_0_-1px_0_var(--amber-400)]',
  error: 'bg-red-100 text-red-900 shadow-[inset_0_-1px_0_var(--red-400)]',
  violet: 'bg-purple-100 text-purple-900 shadow-[inset_0_-1px_0_var(--purple-400)]'
}

export function Banner({ type = 'default', icon, action, children, className, onClose }: BannerProps) {
  return (
    <div role={type === 'error' ? 'alert' : 'status'} className={cn('flex min-h-12 items-center gap-3 px-4 py-2 text-sm', types[type], className)}>
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onClose && (
        <Button type="tertiary" size="small" svgOnly aria-label="Dismiss" tooltip onClick={onClose}>
          <XGlyph size={16} />
        </Button>
      )}
    </div>
  )
}
