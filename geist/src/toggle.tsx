// Geist Toggle (https://vercel.com/geist/toggle), medium size (36x20 track, 17px knob):
// a boolean that applies immediately.
import type { ReactNode } from 'react'
import { cn } from './cn'

export function ToggleTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-toggle-track=""
      className={cn(
        'relative inline-block h-5 w-9 flex-none rounded-full transition-colors',
        on ? 'bg-blue-700' : 'bg-gray-400'
      )}
    >
      <span
        className={cn(
          'absolute top-[1.5px] size-[17px] rounded-full bg-[var(--toggle-knob)] shadow-[0_0_3px_-1px_#0000003d,0_0_0.5px_#00000029,-0.5px_2px_3px_-2px_#0000005c] transition-[left]',
          on ? 'left-[17.5px]' : 'left-[1.5px]'
        )}
      />
    </span>
  )
}

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  children?: ReactNode
  /** Puts the label before the track and spreads them apart, as in settings rows. */
  layout?: 'inline' | 'row'
  className?: string
  disabled?: boolean
  /** Names the switch when it has no visible label. */
  'aria-label'?: string
  id?: string
}

export function Toggle({ checked, onChange, children, layout = 'inline', className, disabled, id, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-label={rest['aria-label']}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex cursor-pointer items-center gap-2 text-[13px] text-gray-900 disabled:cursor-not-allowed disabled:opacity-60',
        layout === 'row' && 'w-full justify-between',
        className
      )}
    >
      {layout === 'row' ? (
        <>
          {children}
          <ToggleTrack on={checked} />
        </>
      ) : (
        <>
          <ToggleTrack on={checked} />
          {children}
        </>
      )}
    </button>
  )
}
