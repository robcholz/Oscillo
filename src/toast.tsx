// Geist Toast (https://vercel.com/geist/toast): "{Noun} {past participle}", polite live region.
import { Button } from './button'

export interface ToastItem {
  id: number
  title: string
  detail?: string
  /** One short action, e.g. Undo. Running it dismisses the toast. */
  action?: { label: string; run: () => void }
}

export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex min-w-80 max-w-[420px] items-center gap-4 rounded-medium bg-background-100 px-4 py-3.5 shadow-menu"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm">{t.title}</span>
            {t.detail && <span className="truncate font-mono text-xs text-gray-700">{t.detail}</span>}
          </span>
          {t.action && (
            <Button
              type="secondary"
              size="small"
              className="!h-7 !px-2.5 !text-[13px]"
              onClick={() => {
                t.action?.run()
                onDismiss(t.id)
              }}
            >
              {t.action.label}
            </Button>
          )}
          <Button type="tertiary" size="small" svgOnly aria-label="Dismiss notification" onClick={() => onDismiss(t.id)} className="!size-7">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Button>
        </div>
      ))}
    </div>
  )
}
