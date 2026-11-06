// Geist Modal (https://vercel.com/geist/modal) on Radix Dialog.
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  actions: ReactNode
  /** Wraps body and actions in a form; actions with typeName="submit" submit it. */
  onSubmit?: () => void
  /** Return true to keep the modal open on Esc (e.g. to back out of a field instead). */
  onEscape?: () => boolean
  /** Dialog width in px (Geist default 480). */
  width?: number
}

export function Modal({ open, onClose, title, description, children, actions, onSubmit, onEscape, width = 480 }: ModalProps) {
  const body = (
    <>
      <div className="flex flex-col gap-5 bg-background-200 p-5">
        <div className="flex flex-col gap-2">
          <Dialog.Title className="m-0 text-xl font-semibold leading-[26px] tracking-[-0.4px]">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="m-0 text-sm text-gray-900">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
        </div>
        {children}
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-200 p-3">{actions}</div>
    </>
  )
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Content style={{ width }}
          className="fixed left-1/2 top-[120px] z-50 max-w-[calc(100%-32px)] -translate-x-1/2 overflow-hidden rounded-medium bg-background-100 text-gray-1000 shadow-modal outline-none"
          onEscapeKeyDown={(e) => onEscape?.() && e.preventDefault()}
        >
          {onSubmit ? (
            <form
              className="m-0"
              onSubmit={(e) => {
                e.preventDefault()
                onSubmit()
              }}
            >
              {body}
            </form>
          ) : (
            body
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
