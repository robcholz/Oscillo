// Geist Empty State (https://vercel.com/geist/empty-state): title, one sentence, one action.
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      {icon && <div className="text-gray-900">{icon}</div>}
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-base font-semibold tracking-[-0.32px] text-gray-1000">{title}</h2>
        {description && <p className="m-0 max-w-sm text-sm text-gray-900">{description}</p>}
      </div>
      {action}
    </div>
  )
}
