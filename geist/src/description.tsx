// Geist Description (https://vercel.com/geist/description): a small label over a value.
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface DescriptionProps {
  title: ReactNode
  content?: ReactNode
  children?: ReactNode
  mono?: boolean
  className?: string
}

export function Description({ title, content, children, mono, className }: DescriptionProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="text-[13px] leading-4 text-gray-900">{title}</div>
      <div className={cn('text-sm font-medium tabular-nums text-gray-1000', mono && 'font-mono text-[13px]')}>{content ?? children}</div>
    </div>
  )
}
