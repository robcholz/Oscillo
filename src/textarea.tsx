// Geist Textarea (https://vercel.com/geist/textarea).
import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function Textarea(
  { className, mono, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      spellCheck={false}
      className={cn(
        'min-w-0 resize-y rounded-small border-0 bg-background-100 px-3 py-2 text-sm text-gray-1000 shadow-[0_0_0_1px_var(--gray-alpha-400)] outline-none placeholder:text-gray-700',
        'hover:shadow-[0_0_0_1px_var(--gray-alpha-500)] focus:shadow-focus-border',
        mono && 'font-mono text-[13px]',
        className
      )}
      {...rest}
    />
  )
})
