// Geist Tooltip (https://vercel.com/geist/tooltip): inverted label, 13px medium, optional shortcut.
import { Tooltip as RadixTooltip } from 'radix-ui'
import { createContext, useContext, type ReactNode } from 'react'
import { Kbd } from './kbd'

export interface TooltipProps {
  text: ReactNode
  children: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  /** Milliseconds before it opens. Geist uses a short delay; toolbars skip it once one is open. */
  delay?: number
  /** A shortcut shown after the text, e.g. ['⌘', 'K']. */
  keys?: string[]
  disabled?: boolean
}

const HasProvider = createContext(false)

/** Put once near the app root so moving between toolbar buttons skips the delay. */
export function TooltipProvider({ children, delay = 300 }: { children: ReactNode; delay?: number }) {
  return (
    <RadixTooltip.Provider delayDuration={delay} skipDelayDuration={300}>
      <HasProvider.Provider value={true}>{children}</HasProvider.Provider>
    </RadixTooltip.Provider>
  )
}

export function Tooltip({ text, children, position = 'top', delay, keys, disabled }: TooltipProps) {
  const provided = useContext(HasProvider)
  if (disabled || text == null || text === '') return <>{children}</>
  const tip = (
    <RadixTooltip.Root delayDuration={delay}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={position}
          sideOffset={8}
          collisionPadding={8}
          className="z-[70] flex select-none items-center gap-2 whitespace-nowrap rounded-small bg-gray-1000 px-2.5 py-1.5 text-[13px] font-medium leading-4 text-background-100 shadow-menu"
        >
          {text}
          {keys && keys.length > 0 && (
            <Kbd small keys={keys} className="!bg-transparent !text-gray-500 !shadow-[inset_0_0_0_1px_var(--gray-alpha-700)]" />
          )}
          <RadixTooltip.Arrow width={10} height={5} className="fill-gray-1000" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
  return provided ? tip : <TooltipProvider>{tip}</TooltipProvider>
}
