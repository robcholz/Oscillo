// Geist Split Button (https://vercel.com/geist/split-button): a default action plus a menu
// whose first item mirrors the label.
import type { ReactNode } from 'react'
import { Button } from './button'
import { MenuContent, MenuRoot, MenuTrigger } from './menu'

export interface SplitButtonProps {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  prefix?: ReactNode
  menuLabel: string
  menu: ReactNode
}

export function SplitButton({ children, onClick, disabled, prefix, menuLabel, menu }: SplitButtonProps) {
  return (
    <div className="flex">
      <Button type="secondary" size="small" onClick={onClick} disabled={disabled} prefix={prefix} className="rounded-r-none">
        {children}
      </Button>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button type="secondary" size="small" svgOnly aria-label={menuLabel} className="ml-px rounded-l-none">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </Button>
        </MenuTrigger>
        <MenuContent align="end">{menu}</MenuContent>
      </MenuRoot>
    </div>
  )
}
