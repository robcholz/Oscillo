// Geist Menu Button and the "…" menu (https://vercel.com/geist/menu): a button that opens a Menu.
import type { ReactNode } from 'react'
import { Button, type ButtonProps } from './button'
import { ChevronDownGlyph, EllipsisGlyph } from './icons'
import { MenuContent, MenuRoot, MenuTrigger } from './menu'

export interface MenuButtonProps {
  children: ReactNode
  /** The menu's items (MenuItem, MenuGroup, MenuSeparator…). */
  menu: ReactNode
  type?: ButtonProps['type']
  size?: ButtonProps['size']
  prefix?: ReactNode
  /** Defaults to a chevron; null hides it. */
  suffix?: ReactNode | null
  width?: number
  align?: 'start' | 'end'
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

export function MenuButton({ children, menu, type = 'secondary', size = 'small', prefix, suffix, width = 240, align = 'start', disabled, className, ...rest }: MenuButtonProps) {
  return (
    <MenuRoot>
      <MenuTrigger asChild disabled={disabled}>
        <Button
          type={type}
          size={size}
          prefix={prefix}
          suffix={suffix === null ? undefined : (suffix ?? <span className="text-gray-900"><ChevronDownGlyph size={16} /></span>)}
          aria-label={rest['aria-label']}
          className={className}
        >
          {children}
        </Button>
      </MenuTrigger>
      <MenuContent width={width} align={align}>
        {menu}
      </MenuContent>
    </MenuRoot>
  )
}

export interface DotsMenuProps {
  menu: ReactNode
  'aria-label'?: string
  size?: ButtonProps['size']
  width?: number
  align?: 'start' | 'end'
}

export function DotsMenu({ menu, size = 'small', width = 200, align = 'end', ...rest }: DotsMenuProps) {
  const label = rest['aria-label'] ?? 'More Actions'
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button type="tertiary" size={size} svgOnly aria-label={label} tooltip>
          <EllipsisGlyph size={16} />
        </Button>
      </MenuTrigger>
      <MenuContent width={width} align={align}>
        {menu}
      </MenuContent>
    </MenuRoot>
  )
}
