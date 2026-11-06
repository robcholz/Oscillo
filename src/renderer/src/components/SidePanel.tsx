// The settings panel on the right of a split page. One control does everything: drag its edge to
// resize, drag past the minimum or double-click to hide, click the edge tab to bring it back.
// ⌥⌘0 toggles it. The width is remembered per page.
import { Tooltip } from '@robcholz/geist'
import { useEffect, useRef, type ReactNode } from 'react'
import { useStore } from '../store'

const MIN = 264
const MAX = 520
const DEFAULT = 320

export function SidePanel({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const pref = useStore((s) => s.panels[id])
  const setPanel = useStore((s) => s.setPanel)
  const width = pref?.width ?? DEFAULT
  const hidden = pref?.hidden ?? false
  const drag = useRef<{ x: number; w: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.altKey && e.code === 'Digit0') {
        e.preventDefault()
        setPanel(id, { hidden: !hidden })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [id, hidden, setPanel])

  if (hidden)
    return (
      <Tooltip text={'Show ' + label} keys={['⌥', '⌘', '0']} position="left">
        <button
          type="button"
          aria-label={'Show ' + label}
          onClick={() => setPanel(id, { hidden: false })}
          className="group relative w-3 flex-none cursor-pointer bg-transparent shadow-[inset_1px_0_0_var(--gray-alpha-400)] outline-none"
        >
          <span className="absolute left-1 top-1/2 -mt-4 h-8 w-1 rounded-sm bg-gray-alpha-500 transition-all group-hover:-mt-6 group-hover:h-12 group-hover:bg-gray-alpha-900 group-focus-visible:shadow-focus-ring" />
        </button>
      </Tooltip>
    )

  return (
    <div style={{ width }} className="relative flex min-h-0 flex-none">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={'Resize ' + label}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize, double-click to hide"
        onDoubleClick={() => setPanel(id, { hidden: true })}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setPanel(id, { width: Math.min(MAX, width + 16) })
          if (e.key === 'ArrowRight') setPanel(id, { width: Math.max(MIN, width - 16) })
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: width }
          e.currentTarget.setPointerCapture(e.pointerId)
          document.documentElement.classList.add('wf-resizing')
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const w = drag.current.w + (drag.current.x - e.clientX)
          if (w < MIN - 80) return
          setPanel(id, { width: Math.max(MIN, Math.min(MAX, w)) })
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          document.documentElement.classList.remove('wf-resizing')
          if (d && d.w + (d.x - e.clientX) < MIN - 80) setPanel(id, { hidden: true, width: d.w })
        }}
        className="group absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize outline-none"
      >
        <span className="absolute inset-y-0 left-[3px] w-0.5 bg-transparent transition-colors delay-100 group-hover:bg-blue-700 group-focus-visible:bg-blue-700" />
      </div>
      <aside aria-label={label} className="flex min-w-0 flex-1 flex-col overflow-y-auto shadow-[inset_1px_0_0_var(--gray-alpha-400)]">
        {children}
      </aside>
    </div>
  )
}
