// Geist Collapse (https://vercel.com/geist/collapse).
import { useId, useState, type ReactNode } from 'react'
import { cn } from './cn'
import { ChevronDownGlyph } from './icons'

export interface CollapseProps {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  size?: 'small' | 'medium'
  className?: string
}

export function Collapse({ title, children, defaultOpen, open: openProp, onOpenChange, size = 'medium', className }: CollapseProps) {
  const [own, setOwn] = useState(!!defaultOpen)
  const open = openProp ?? own
  const id = useId()
  return (
    <div className={cn('shadow-[inset_0_-1px_0_var(--gray-alpha-400)]', className)}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOwn(!open)
            onOpenChange?.(!open)
          }}
          className={cn(
            'flex w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent text-left font-semibold text-gray-1000',
            size === 'small' ? 'py-3 text-base leading-6 tracking-[-0.32px]' : 'py-6 text-xl leading-[26px] tracking-[-0.4px]'
          )}
        >
          <span>{title}</span>
          <span className={cn('transition-transform duration-150', open && 'rotate-180')}>
            <ChevronDownGlyph />
          </span>
        </button>
      </h3>
      {open && (
        <div id={id} className={cn('text-sm text-gray-900', size === 'small' ? 'pb-3' : 'pb-6')}>
          {children}
        </div>
      )}
    </div>
  )
}
