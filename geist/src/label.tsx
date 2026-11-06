// A field label (13/16 gray-900) above a control, as Geist forms set them.
import type { ReactNode } from 'react'
import { cn } from './cn'

export function Field({ label, htmlFor, children, className }: { label: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <label htmlFor={htmlFor} className="text-[13px] leading-4 text-gray-900">
        {label}
      </label>
      {children}
    </div>
  )
}
