// Geist Note (https://vercel.com/geist/note).
import type { ReactNode } from 'react'
import { cn } from './cn'
import { CircleAlertGlyph, CircleCheckGlyph, InfoGlyph, TriangleAlertGlyph } from './icons'

export type NoteType = 'default' | 'secondary' | 'success' | 'error' | 'warning' | 'violet' | 'cyan'

const types: Record<NoteType, string> = {
  default: 'text-gray-1000 bg-background-100 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]',
  secondary: 'text-gray-900 bg-background-100 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]',
  success: 'text-blue-900 bg-blue-100 shadow-[inset_0_0_0_1px_var(--blue-400)]',
  error: 'text-red-900 bg-red-100 shadow-[inset_0_0_0_1px_var(--red-400)]',
  warning: 'text-amber-900 bg-amber-100 shadow-[inset_0_0_0_1px_var(--amber-400)]',
  violet: 'text-purple-900 bg-purple-100 shadow-[inset_0_0_0_1px_var(--purple-400)]',
  cyan: 'text-teal-900 bg-teal-100 shadow-[inset_0_0_0_1px_var(--teal-400)]'
}
const sizes = { small: 'px-2 py-1.5 text-[13px] leading-[18px]', medium: 'px-3 py-2 text-sm', large: 'px-4 py-3 text-base leading-6' }

export interface NoteProps {
  type?: NoteType
  size?: 'small' | 'medium' | 'large'
  /** false hides the icon. */
  label?: boolean
  action?: ReactNode
  children: ReactNode
  className?: string
}

export function Note({ type = 'default', size = 'medium', label = true, action, children, className }: NoteProps) {
  const icon =
    type === 'success' ? <CircleCheckGlyph /> : type === 'error' ? <CircleAlertGlyph /> : type === 'warning' ? <TriangleAlertGlyph /> : <InfoGlyph />
  return (
    <div role={type === 'error' ? 'alert' : 'note'} className={cn('flex items-center gap-3 rounded-small', types[type], sizes[size], className)}>
      {label && icon}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}
