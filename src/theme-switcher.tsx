// Geist Theme Switcher (https://vercel.com/geist/theme-switcher), measured on the live page:
// a 32px pill of three 32px round options, the chosen one raised on background-100.
// Icons are Lucide (monitor, sun, moon; https://lucide.dev, ISC).
import type { ReactNode } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'

const options: { value: ThemePref; label: string; icon: ReactNode }[] = [
  {
    value: 'system',
    label: 'System',
    icon: (
      <>
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </>
    )
  },
  {
    value: 'light',
    label: 'Light',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </>
    )
  },
  { value: 'dark', label: 'Dark', icon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /> }
]

export function ThemeSwitcher({ value, onChange }: { value: ThemePref; onChange: (value: ThemePref) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="flex h-8 rounded-full shadow-[0_0_0_1px_var(--gray-alpha-400),0_0_0_1px_var(--background-200)]">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={
              'flex size-8 cursor-pointer items-center justify-center rounded-full ' +
              (on
                ? 'bg-background-100 text-gray-1000 shadow-[0_0_0_1px_var(--gray-400),0_1px_2px_0_var(--gray-alpha-100)]'
                : 'text-gray-700 hover:text-gray-1000') +
              ' kbd-focus:shadow-focus-ring'
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {o.icon}
            </svg>
          </button>
        )
      })}
    </div>
  )
}
