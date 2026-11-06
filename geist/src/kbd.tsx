// Geist Keyboard Input (https://vercel.com/geist/keyboard-input). One box per combination, with a
// span per key: <Kbd keys={['shift', 'meta', 'A']} /> reads ⇧⌘A.
import type { ReactNode } from 'react'
import { cn } from './cn'

const SYM: Record<string, string> = { meta: '⌘', command: '⌘', cmd: '⌘', shift: '⇧', alt: '⌥', option: '⌥', ctrl: '⌃', control: '⌃', enter: '↵' }

export interface KbdProps {
  /** Keys of one combination, in macOS order (⌃ ⌥ ⇧ ⌘, then the key). Names like meta map to symbols. */
  keys?: string[]
  meta?: boolean
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
  small?: boolean
  children?: ReactNode
  className?: string
}

export function Kbd({ keys, meta, shift, alt, ctrl, small, children, className }: KbdProps) {
  const list: ReactNode[] = [...(ctrl ? ['⌃'] : []), ...(alt ? ['⌥'] : []), ...(shift ? ['⇧'] : []), ...(meta ? ['⌘'] : []), ...(keys ?? []).map((k) => SYM[k.toLowerCase()] ?? k)]
  if (children != null) list.push(children)
  return (
    <kbd
      data-geist-kbd=""
      className={cn(
        'inline-flex items-center justify-center gap-0.5 rounded-kbd bg-background-100 font-sans text-gray-900 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]',
        small ? 'h-5 min-w-5 px-1 text-xs leading-4' : 'h-6 min-w-6 px-1.5 text-sm leading-5',
        className
      )}
    >
      {list.map((k, i) => (
        <span key={i}>{k}</span>
      ))}
    </kbd>
  )
}
