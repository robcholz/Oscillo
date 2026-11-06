// The message Geist's Input shows under a field with an `error` (https://vercel.com/geist/input):
// 16px stop icon and 13/20 text in red-900, 8px below the field.
import type { ReactNode } from 'react'
import { cn } from './cn'

export function ErrorMessage({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <div id={id} role="alert" aria-atomic="true" className={cn('flex items-start gap-2 text-[13px] leading-5 text-red-900', className)}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 flex-none">
        <path
          fill="currentColor"
          d="M10.9 0a1 1 0 0 1 .7.3l4.1 4.1.07.07a1 1 0 0 1 .23.63v5.8a1 1 0 0 1-.3.7l-4.1 4.1a1 1 0 0 1-.7.3H5a1 1 0 0 1-.53-.23l-.08-.06-4.1-4.1A1 1 0 0 1 0 10.9V5.1a1 1 0 0 1 .3-.7L4.4.3A1 1 0 0 1 5 0h5.9M1.5 5.3v5.4l3.8 3.8h5.4l3.8-3.8V5.3l-3.8-3.8H5.3zM8 10a1 1 0 1 1 0 2 1 1 0 0 1 0-2m.75-1.25h-1.5v-5h1.5z"
        />
      </svg>
      <span className="break-words">{children}</span>
    </div>
  )
}

/** Geist's error ring for a field: red-900 line and red-300 halo (red-500 on hover). */
export const errorRing =
  'shadow-[0_0_0_1px_var(--red-900),0_0_0_4px_var(--red-300)] hover:shadow-[0_0_0_1px_var(--red-900),0_0_0_4px_var(--red-500)] focus-within:shadow-[0_0_0_1px_var(--red-900),0_0_0_4px_var(--red-300)] focus-visible:shadow-[0_0_0_1px_var(--red-900),0_0_0_4px_var(--red-300)]'
