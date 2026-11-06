// Geist Table (https://vercel.com/geist/table).
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface TableColumn<R> {
  key: string
  title: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: number | string
  mono?: boolean
  render?: (row: R, index: number) => ReactNode
}

export interface TableProps<R> {
  columns: TableColumn<R>[]
  rows: R[]
  caption?: string
  striped?: boolean
  compact?: boolean
  /** Makes rows clickable (and keyboard operable). */
  onRowClick?: (row: R, index: number) => void
  isSelected?: (row: R, index: number) => boolean
  rowKey?: (row: R, index: number) => string | number
  className?: string
}

export function Table<R>({ columns, rows, caption, striped, compact, onRowClick, isSelected, rowKey, className }: TableProps<R>) {
  const cell = compact ? 'h-8 py-1.5' : 'h-10 py-2.5'
  return (
    <div className={cn('min-w-0 overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm tabular-nums text-gray-1000">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ textAlign: c.align ?? 'left', width: c.width }}
                className="h-10 whitespace-nowrap bg-background-200 px-2 text-xs font-medium text-gray-900 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]"
              >
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const sel = isSelected?.(r, i)
            return (
              <tr
                key={rowKey ? rowKey(r, i) : i}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(r, i) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onRowClick(r, i)
                        }
                      }
                    : undefined
                }
                aria-selected={onRowClick ? !!sel : undefined}
                className={cn(
                  striped && 'even:bg-background-200',
                  sel && 'bg-gray-alpha-100',
                  onRowClick && 'cursor-pointer outline-none hover:bg-gray-alpha-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700'
                )}
              >
                {columns.map((c) => {
                  const v = c.render ? c.render(r, i) : ((r as Record<string, ReactNode>)[c.key] ?? null)
                  return (
                    <td key={c.key} style={{ textAlign: c.align ?? 'left' }} className={cn('px-2 align-middle shadow-[inset_0_-1px_0_var(--gray-alpha-400)]', cell, c.mono && 'font-mono text-[13px]')}>
                      {v}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
