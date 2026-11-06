// Geist Keyboard Input (https://vercel.com/geist/keyboard-input).
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface KbdProps {
  meta?: boolean
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
  small?: boolean
  children?: ReactNode
  className?: string
}

export function Kbd({ meta, shift, alt, ctrl, small, children, className }: KbdProps) {
  return (
    <kbd
      data-geist-kbd=""
      className={cn(
        'inline-flex min-h-6 min-w-6 items-center justify-center gap-0.5 rounded-kbd bg-background-100 px-1.5 font-sans leading-[1.7em] text-gray-1000 shadow-[0_0_0_1px_var(--gray-alpha-400)]',
        small ? 'h-5 min-h-0 min-w-5 px-1 text-xs leading-none' : 'text-sm',
        className
      )}
    >
      {meta && <span>⌘</span>}
      {shift && <span>⇧</span>}
      {alt && <span>⌥</span>}
      {ctrl && <span>⌃</span>}
      {children && <span>{children}</span>}
    </kbd>
  )
}
