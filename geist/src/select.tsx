// Geist Select (https://vercel.com/geist/select). Geist's own Select opens the
// native OS menu; Tether opens a list box styled like Geist's Menu instead
// (Radix Select for keyboard, typeahead and focus handling).
import { Select as RadixSelect } from 'radix-ui'
import { cn } from './cn'

export interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  /** `sans` sets one item in the UI font inside a mono list (e.g. "Custom…"). */
  options: readonly (string | { value: string; label: string; sans?: boolean; group?: string })[]
  size?: 'small' | 'medium'
  /** Borderless trigger used inside property rows. */
  variant?: 'default' | 'ghost'
  mono?: boolean
  id?: string
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

const heights = { small: 'h-8', medium: 'h-9' }

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="flex-none text-gray-700">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function Select({ value, onValueChange, options, size = 'medium', variant = 'default', mono, id, disabled, className, ...rest }: SelectProps) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o, sans: false, group: undefined } : o))
  // Long lists (over ten) are split into labelled groups, as Geist does.
  const groups: (string | undefined)[] = []
  for (const o of opts) if (!groups.includes(o.group)) groups.push(o.group)
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        aria-label={rest['aria-label']}
        className={cn(
          'flex min-w-0 cursor-pointer items-center justify-between gap-2 border-0 text-sm text-gray-1000 outline-none disabled:cursor-not-allowed disabled:text-gray-700',
          variant === 'default' &&
            cn(
              heights[size],
              'w-full rounded-small bg-background-100 px-3 shadow-[0_0_0_1px_var(--gray-alpha-400)] hover:shadow-[0_0_0_1px_var(--gray-alpha-500)] focus-visible:shadow-focus-border data-[state=open]:shadow-focus-border'
            ),
          variant === 'ghost' && 'h-7 max-w-[170px] gap-1.5 rounded-kbd bg-transparent pl-2 pr-1 hover:bg-gray-alpha-100 focus-visible:shadow-focus-border',
          mono && 'font-mono text-[13px]',
          className
        )}
      >
        <span className="truncate">
          <RadixSelect.Value />
        </span>
        <RadixSelect.Icon asChild>
          <Chevron />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          align={variant === 'ghost' ? 'end' : 'start'}
          className="z-50 max-h-[296px] min-w-[max(160px,var(--radix-select-trigger-width))] overflow-hidden rounded-medium bg-background-100 shadow-menu"
        >
          <RadixSelect.Viewport className="p-1.5">
            {groups.map((g, gi) => (
              <RadixSelect.Group key={g ?? gi} className={cn(gi > 0 && 'mt-1 border-t border-gray-alpha-200 pt-1')}>
                {g && <RadixSelect.Label className="px-2 pb-1 pt-2 text-xs text-gray-700">{g}</RadixSelect.Label>}
                {opts.filter((o) => o.group === g).map((o) => (
                  <RadixSelect.Item
                    key={o.value}
                    value={o.value}
                    className={cn(
                      'flex h-9 cursor-pointer select-none items-center justify-between gap-2.5 rounded-small px-2 text-sm text-gray-900 outline-none',
                      'data-[highlighted]:bg-gray-alpha-100 data-[highlighted]:text-gray-1000 data-[state=checked]:text-gray-1000',
                      mono && !o.sans && 'font-mono text-[13px]'
                    )}
                  >
                    <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                    <RadixSelect.ItemIndicator>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </RadixSelect.ItemIndicator>
                  </RadixSelect.Item>
                ))}
              </RadixSelect.Group>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
