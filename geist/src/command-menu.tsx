// Geist Command Menu (https://vercel.com/geist/command-menu) on cmdk.
import { Command } from 'cmdk'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { Kbd } from './kbd'
import { SearchIcon } from './input'

export interface CommandItem {
  id: string
  group: string
  label: string
  hint?: string
  keys?: string[]
  icon?: ReactNode
  /** Extra words that should find this item. */
  keywords?: string
  run: () => void
}

export interface CommandMenuProps {
  open: boolean
  setOpen: (open: boolean) => void
  items: CommandItem[]
  placeholder?: string
  /** The line under "No Matching Commands", e.g. what people can search for. */
  emptyHint?: ReactNode
  /** The dialog's accessible description. */
  description?: string
}

export function CommandMenu({ open, setOpen, items, placeholder = 'Search commands…', emptyHint, description = 'Search commands' }: CommandMenuProps) {
  const groups: string[] = []
  for (const it of items) if (!groups.includes(it.group)) groups.push(it.group)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Content
          aria-label="Command menu"
          className="fixed left-1/2 top-[120px] z-50 flex h-[460px] w-[640px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-medium bg-background-100 text-sm text-gray-1000 shadow-modal outline-none"
        >
          <Dialog.Title className="sr-only">Command menu</Dialog.Title>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          <Command label="Commands" loop className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-14 items-center gap-2.5 border-b border-gray-200 px-4 text-gray-700">
              <SearchIcon size={16} />
              <Command.Input
                autoFocus
                placeholder={placeholder}
                className="flex-1 border-0 bg-transparent text-base text-gray-1000 outline-none placeholder:text-gray-700 focus-visible:shadow-none"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close command menu"
                className="inline-flex h-5 cursor-pointer items-center rounded-kbd bg-gray-100 px-1.5 text-xs text-gray-900 shadow-[0_0_0_1px_var(--gray-alpha-400)]"
              >
                Esc
              </button>
            </div>
            <Command.List className="min-h-0 flex-1 overflow-auto overscroll-contain p-1.5">
              <Command.Empty className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
                <span className="text-sm font-medium">No Matching Commands</span>
                {emptyHint && <span className="text-[13px] text-gray-700">{emptyHint}</span>}
              </Command.Empty>
              {groups.map((g) => (
                <Command.Group
                  key={g}
                  heading={g}
                  className="pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-gray-700"
                >
                  {items
                    .filter((i) => i.group === g)
                    .map((i) => (
                      <Command.Item
                        key={i.id}
                        value={`${i.label} ${i.hint ?? ''} ${i.keywords ?? ''} ${i.group}`}
                        onSelect={() => {
                          setOpen(false)
                          i.run()
                        }}
                        className="flex h-9 cursor-pointer items-center gap-2 rounded-small px-2 text-gray-900 data-[selected=true]:bg-gray-alpha-200 data-[selected=true]:text-gray-1000"
                      >
                        {i.icon && <span className="flex flex-none text-gray-900">{i.icon}</span>}
                        <span className="flex-1">{i.label}</span>
                        {i.hint && <span className="font-mono text-xs text-gray-700">{i.hint}</span>}
                        {i.keys && <Kbd small>{i.keys.join('')}</Kbd>}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
          <div className="flex h-10 items-center gap-4 border-t border-gray-200 px-4 text-xs text-gray-700">
            <span className="flex items-center gap-1.5">
              <Kbd small>↑</Kbd>
              <Kbd small>↓</Kbd> Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd small>↵</Kbd> Run
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
