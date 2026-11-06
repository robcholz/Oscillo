// Geist Materials (https://vercel.com/geist/materials): the surface for cards, popovers and dialogs.
import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from './cn'

export type MaterialType = 'base' | 'small' | 'medium' | 'large' | 'tooltip' | 'menu' | 'modal' | 'fullscreen'

const types: Record<MaterialType, string> = {
  base: 'rounded-small shadow-[0_0_0_1px_var(--gray-alpha-400)]',
  small: 'rounded-small shadow-small',
  medium: 'rounded-medium shadow-medium',
  large: 'rounded-medium shadow-medium',
  tooltip: 'rounded-small shadow-tooltip',
  menu: 'rounded-medium shadow-menu',
  modal: 'rounded-medium shadow-modal',
  fullscreen: 'rounded-fullscreen shadow-modal'
}

export interface MaterialProps extends HTMLAttributes<HTMLDivElement> {
  type?: MaterialType
}

export const Material = forwardRef<HTMLDivElement, MaterialProps>(function Material({ type = 'base', className, ...rest }, ref) {
  return <div ref={ref} className={cn('bg-background-100 text-gray-1000', types[type], className)} {...rest} />
})
