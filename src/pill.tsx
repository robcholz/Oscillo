// Geist Pill: a rounded toggle or link used for filters.
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface PillProps {
  active?: boolean
  onClick?: () => void
  size?: 'small' | 'medium'
  icon?: ReactNode
  children: ReactNode
  className?: string
}

export function Pill({ active, onClick, size = 'medium', icon, children, className }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full font-medium',
        size === 'small' ? 'h-6 px-2.5 text-xs' : 'h-8 px-3 text-sm',
        active ? 'bg-gray-1000 text-background-100' : 'bg-background-100 text-gray-1000 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)] hover:bg-gray-alpha-100',
        className
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}
