// Geist Menu (https://vercel.com/geist/menu) on Radix Dropdown Menu.
import { DropdownMenu } from 'radix-ui'
import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from './cn'

export const MenuRoot = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export function MenuContent({ children, width = 240, align = 'start' }: { children: ReactNode; width?: number; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        style={{ width }}
        className="z-40 rounded-medium bg-background-100 p-1.5 shadow-menu outline-none"
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  )
}

const itemClass =
  'flex min-h-9 w-full cursor-pointer select-none items-center gap-2.5 rounded-small px-2 text-left text-sm text-gray-1000 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-gray-700 data-[highlighted]:bg-gray-alpha-100'

export interface MenuItemProps {
  children: ReactNode
  onSelect?: () => void
  disabled?: boolean
  /** Icon before the label. */
  prefix?: ReactNode
  /** A second line under the label. */
  description?: ReactNode
  /** Shortcut shown at the right, e.g. ['⌘', 'S']. */
  shortcut?: string[]
  /** Destructive actions are red. */
  danger?: boolean
}

export function MenuItem({ children, onSelect, disabled, prefix, description, shortcut, danger }: MenuItemProps) {
  return (
    <DropdownMenu.Item className={cn(itemClass, danger && 'text-red-900')} onSelect={onSelect} disabled={disabled}>
      {prefix && <span className={cn('flex flex-none', danger ? 'text-red-900' : 'text-gray-900')}>{prefix}</span>}
      <span className="flex min-w-0 flex-1 flex-col py-1.5">
        <span className="truncate">{children}</span>
        {description && <span className="truncate font-mono text-xs text-gray-900">{description}</span>}
      </span>
      {shortcut && <span className="ml-auto pl-2 text-xs text-gray-700">{shortcut.join('')}</span>}
    </DropdownMenu.Item>
  )
}

/** A menu item that shows a check when on (DropdownMenu.CheckboxItem). */
export function MenuCheckboxItem({ children, checked, onCheckedChange, prefix, description }: { children: ReactNode; checked: boolean; onCheckedChange: (on: boolean) => void; prefix?: ReactNode; description?: ReactNode }) {
  return (
    <DropdownMenu.CheckboxItem className={itemClass} checked={checked} onCheckedChange={onCheckedChange} onSelect={(e) => e.preventDefault()}>
      {prefix && <span className="flex flex-none text-gray-900">{prefix}</span>}
      <span className="flex min-w-0 flex-1 flex-col py-1.5">
        <span className="truncate">{children}</span>
        {description && <span className="truncate font-mono text-xs text-gray-900">{description}</span>}
      </span>
      <DropdownMenu.ItemIndicator className="ml-auto flex">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 12l5 5 9-10" />
        </svg>
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.CheckboxItem>
  )
}

export function MenuRadioItem({
  value,
  children,
  className,
  indicatorClassName,
  onKeyDown
}: {
  value: string
  children: ReactNode
  className?: string
  indicatorClassName?: string
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
}) {
  return (
    <DropdownMenu.RadioItem value={value} className={cn(itemClass, className)} onKeyDown={onKeyDown}>
      {children}
      <DropdownMenu.ItemIndicator className={cn('ml-auto flex', indicatorClassName)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 12l5 5 9-10" />
        </svg>
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  )
}

export const MenuRadioGroup = DropdownMenu.RadioGroup

export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Group className="flex flex-col pb-1">
      <DropdownMenu.Label className="px-2 pb-1 pt-2 text-xs text-gray-700">{label}</DropdownMenu.Label>
      {children}
    </DropdownMenu.Group>
  )
}

export function MenuSeparator({ className }: { className?: string }) {
  return <DropdownMenu.Separator className={cn('-mx-1.5 mb-1.5 mt-0.5 h-px bg-gray-200', className)} />
}
