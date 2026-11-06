// A chart legend entry in Geist's chart style: a short line (or square marker) in the series colour,
// the series name and an optional reading. With onToggle it becomes a button that shows or hides it.
import type { ReactNode } from 'react'
import { cn } from './cn'
import { Tooltip } from './tooltip'

export interface LegendItemProps {
  label: ReactNode
  color?: string
  detail?: ReactNode
  size?: 'small' | 'medium'
  dashed?: boolean
  marker?: boolean
  pressed?: boolean
  onToggle?: (pressed: boolean) => void
  /** Name used in "Show …" / "Hide …" when label is not a string. */
  name?: string
  className?: string
}

export function LegendItem({ label, color = 'var(--gray-1000)', detail, size = 'small', dashed, marker, pressed = true, onToggle, name, className }: LegendItemProps) {
  const kids = (
    <>
      <span
        aria-hidden="true"
        style={{ color }}
        className={cn('flex-none', marker ? 'size-2 rounded-[2px] bg-current' : 'h-0 w-3 rounded-[1px] border-t-2 border-current', dashed && 'border-dashed')}
      />
      <span>{label}</span>
      {detail != null && detail !== '' && <span className="font-normal tabular-nums text-gray-900">{detail}</span>}
    </>
  )
  const cls = cn(
    'inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-small bg-transparent font-medium text-gray-1000 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]',
    size === 'small' ? 'h-6 px-2 text-xs leading-4' : 'h-8 px-2.5 text-sm',
    !pressed && 'opacity-50 [&>span:nth-child(2)]:line-through',
    className
  )
  if (!onToggle) return <span className={cls}>{kids}</span>
  const n = name ?? (typeof label === 'string' ? label : 'Series')
  return (
    <Tooltip text={(pressed ? 'Hide ' : 'Show ') + n}>
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => onToggle(!pressed)}
        className={cn(cls, 'cursor-pointer transition-[background-color,box-shadow] hover:bg-gray-alpha-100 hover:shadow-[inset_0_0_0_1px_var(--gray-alpha-500)] active:bg-gray-alpha-200')}
      >
        {kids}
      </button>
    </Tooltip>
  )
}
