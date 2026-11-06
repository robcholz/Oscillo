// Geist Tabs (https://vercel.com/geist/tabs), primary (underline) variant,
// on Radix Tabs for keyboard navigation. Class names follow the Geist DOM.
import { Tabs as RadixTabs } from 'radix-ui'
import { cn } from './cn'

export interface TabItem {
  title: string
  value: string
  disabled?: boolean
  className?: string
}

export interface TabsProps {
  tabs: TabItem[]
  selected: string
  setSelected: (value: string) => void
  className?: string
  /** "header" stretches tabs to the toolbar height and drops the list underline. */
  variant?: 'default' | 'header'
}

export function Tabs({ tabs, selected, setSelected, className, variant = 'default' }: TabsProps) {
  const header = variant === 'header'
  return (
    <RadixTabs.Root value={selected} onValueChange={setSelected} activationMode="manual" className={cn(header && 'flex self-stretch')}>
      <RadixTabs.List
        data-geist-tabs=""
        className={cn(
          header ? 'flex items-stretch gap-4 px-2' : 'flex flex-nowrap items-center gap-6 pb-px shadow-[0_-1px_0_var(--gray-alpha-400)_inset]',
          className
        )}
      >
        {tabs.map((t) => (
          <RadixTabs.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled}
            className={cn(
              'group flex cursor-pointer items-center border-0 border-b-2 border-transparent bg-transparent px-0.5 text-sm text-gray-900 outline-0',
              header ? 'px-1' : '-mb-px py-3.5',
              'aria-selected:border-gray-1000 aria-selected:text-gray-1000 not-disabled:hover:text-gray-1000',
              // The ring hugs the label, not the full-height trigger, and leaves the underline alone.
              'kbd-focus:shadow-none disabled:cursor-not-allowed',
              t.className
            )}
          >
            <span className="-mx-1 rounded-kbd px-1 py-0.5 group-kbd-focus:shadow-focus-ring">{t.title}</span>
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  )
}
