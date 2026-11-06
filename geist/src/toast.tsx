// Geist Toast (https://vercel.com/geist/toast): "{Noun} {past participle}", polite live region.
import { Button } from './button'
import { cn } from './cn'
import { CircleAlertGlyph, CircleCheckGlyph, TriangleAlertGlyph } from './icons'

export interface ToastItem {
  id: number
  title: string
  detail?: string
  /** One short action, e.g. Undo. Running it dismisses the toast. */
  action?: { label: string; run: () => void }
  /** Error is red and warning amber; success adds a check. Plain toasts confirm a routine change. */
  type?: 'success' | 'error' | 'warning'
}

const GLYPH = { success: CircleCheckGlyph, error: CircleAlertGlyph, warning: TriangleAlertGlyph }

export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-[calc(100vw-32px)] flex-col items-end gap-2">
      {toasts.map((t) => {
        const Glyph = t.type ? GLYPH[t.type] : null
        const tinted = t.type === 'error' || t.type === 'warning'
        return (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex max-w-[420px] items-center gap-3 rounded-medium py-2 pl-4 pr-2 shadow-menu',
            t.type === 'error' ? 'bg-red-800 text-white' : t.type === 'warning' ? 'bg-amber-800 text-[#0a0a0a]' : 'bg-background-100'
          )}
        >
          {Glyph && <span className="flex flex-none">{<Glyph size={16} />}</span>}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
            <span className="text-sm">{t.title}</span>
            {t.detail && <span className={cn('line-clamp-2 text-[13px] leading-[18px]', tinted ? 'opacity-80' : 'text-gray-900')}>{t.detail}</span>}
          </span>
          {t.action && (
            <Button
              type={t.type ? 'secondary' : 'primary'}
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
          <Button type="tertiary" size="small" svgOnly aria-label="Dismiss notification" onClick={() => onDismiss(t.id)} className={cn('!size-7', tinted && '!text-current hover:!bg-black/10')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Button>
        </div>
        )
      })}
    </div>
  )
}
