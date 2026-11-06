// Geist Entity (https://vercel.com/geist/entity): an icon, a title and description, and actions in a row.
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface EntityProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}

export function Entity({ icon, title, description, children, className }: EntityProps) {
  return (
    <div className={cn('flex items-center gap-3 p-4 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]', className)}>
      {icon && (
        <span className="flex size-8 flex-none items-center justify-center rounded-small text-gray-1000 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]">{icon}</span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-gray-1000">{title}</span>
        {description && <span className="text-[13px] leading-4 text-gray-900">{description}</span>}
      </div>
      {children && <div className="flex flex-none items-center gap-2">{children}</div>}
    </div>
  )
}
