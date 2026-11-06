// Geist Badge (https://vercel.com/geist/badge).
import type { ReactNode } from 'react'
import { cn } from './cn'

export type BadgeVariant =
  | 'gray' | 'gray-subtle' | 'blue' | 'blue-subtle' | 'purple' | 'purple-subtle' | 'amber' | 'amber-subtle'
  | 'red' | 'red-subtle' | 'pink' | 'pink-subtle' | 'green' | 'green-subtle' | 'teal' | 'teal-subtle' | 'inverted'

const variants: Record<BadgeVariant, string> = {
  gray: 'bg-gray-700 text-[#fff]',
  'gray-subtle': 'bg-gray-200 text-gray-1000',
  blue: 'bg-blue-700 text-[#fff]',
  'blue-subtle': 'bg-blue-200 text-blue-900',
  purple: 'bg-purple-700 text-[#fff]',
  'purple-subtle': 'bg-purple-200 text-purple-900',
  amber: 'bg-amber-700 text-[#0a0a0a]',
  'amber-subtle': 'bg-amber-200 text-amber-900',
  red: 'bg-red-700 text-[#fff]',
  'red-subtle': 'bg-red-200 text-red-900',
  pink: 'bg-pink-700 text-[#fff]',
  'pink-subtle': 'bg-pink-200 text-pink-900',
  green: 'bg-green-700 text-[#fff]',
  'green-subtle': 'bg-green-200 text-green-900',
  teal: 'bg-teal-700 text-[#fff]',
  'teal-subtle': 'bg-teal-200 text-teal-900',
  inverted: 'bg-gray-1000 text-background-100'
}
const sizes = {
  sm: 'h-5 px-1.5 text-[11px] leading-4',
  md: 'h-6 px-2.5 text-xs leading-4',
  lg: 'h-8 px-3 text-sm leading-5'
}

export interface BadgeProps {
  variant?: BadgeVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  children: ReactNode
  className?: string
}

export function Badge({ variant = 'gray', size = 'md', icon, children, className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium tabular-nums', variants[variant], sizes[size], className)}>
      {icon}
      {children}
    </span>
  )
}
