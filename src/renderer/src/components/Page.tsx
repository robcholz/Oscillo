// Page scaffolding shared by every board: the 56px title bar, a scrolling body, and the split layout
// with a resizable settings panel on the right.
import { Input, Select, cn, type InputProps, type SelectProps } from '@robcholz/geist'
import { useId, type ReactNode } from 'react'
import { SidePanel } from './SidePanel'

export function PageBar({ title, status, sub, children }: { title: ReactNode; status?: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="relative z-[5] flex min-h-14 flex-none items-center justify-between gap-3 bg-background-100 px-4 py-2.5 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]">
      <div className="flex min-w-0 flex-[0_1_auto] items-center gap-4 whitespace-nowrap">
        <h1 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">{title}</h1>
        {status}
        {sub && <span className="min-w-0 truncate text-[13px] leading-4 text-gray-900 max-[1180px]:hidden">{sub}</span>}
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>}
    </div>
  )
}

/** A page whose body scrolls, content 16px from every edge. */
export function ScrollPage({ bar, children, className }: { bar: ReactNode; children: ReactNode; className?: string }) {
  return (
    <>
      {bar}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn('p-4', className)}>{children}</div>
      </div>
    </>
  )
}

/** Main content on the left, settings on the right. */
export function SplitPage({ bar, panelId, panel, panelLabel = 'Settings', children, left }: { bar: ReactNode; panelId: string; panel: ReactNode; panelLabel?: string; children: ReactNode; left?: ReactNode }) {
  return (
    <>
      {bar}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {left}
        <section aria-label="Content" className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 [&>*]:flex-none">
          {children}
        </section>
        <SidePanel id={panelId} label={panelLabel}>
          {panel}
        </SidePanel>
      </div>
    </>
  )
}

/** A titled group inside a settings panel. */
export function PanelSection({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3 p-4 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]', className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h2 className="m-0 flex items-center gap-2 text-sm font-semibold leading-5 tracking-[-0.28px]">{title}</h2>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
}

/** Geist Input with its visible label above. */
export function LabeledInput({ label, ...rest }: InputProps & { label: string }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-[13px] leading-4 text-gray-900">
        {label}
      </label>
      <Input id={id} size="small" {...rest} suffix={rest.suffix ? <span className="text-[13px] text-gray-700">{rest.suffix}</span> : undefined} />
    </div>
  )
}

/** Geist Select with its visible label above. */
export function LabeledSelect({ label, ...rest }: Omit<SelectProps, 'aria-label'> & { label: string }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-[13px] leading-4 text-gray-900">
        {label}
      </label>
      <Select id={id} size="small" aria-label={label} {...rest} />
    </div>
  )
}
