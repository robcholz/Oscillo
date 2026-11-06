// Geist Status Dot (https://vercel.com/geist/status-dot).
import { cn } from './cn'

export type StatusDotState = 'QUEUED' | 'BUILDING' | 'ERROR' | 'READY' | 'CANCELED'

const color: Record<StatusDotState, string> = {
  QUEUED: 'bg-gray-alpha-500',
  BUILDING: 'bg-amber-700',
  ERROR: 'bg-red-800',
  READY: 'bg-blue-700',
  CANCELED: 'bg-gray-alpha-500'
}
const defaultLabel: Record<StatusDotState, string> = {
  QUEUED: 'Queued',
  BUILDING: 'Building',
  ERROR: 'Error',
  READY: 'Ready',
  CANCELED: 'Canceled'
}

export interface StatusDotProps {
  state: StatusDotState
  /** true shows the state's own word; a string shows that instead. */
  label?: boolean | string
  className?: string
}

export function StatusDot({ state, label, className }: StatusDotProps) {
  const text = label === true ? defaultLabel[state] : label || undefined
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-gray-1000', className)}>
      <span
        className={cn('size-2.5 flex-none rounded-full', color[state])}
        role={text ? undefined : 'img'}
        aria-label={text ? undefined : defaultLabel[state]}
        aria-hidden={text ? true : undefined}
      />
      {text && <span className="whitespace-nowrap">{text}</span>}
    </span>
  )
}
