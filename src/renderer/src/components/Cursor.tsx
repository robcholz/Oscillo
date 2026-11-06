import { useRef } from 'react'

/** A draggable vertical cursor with its label. */
export function Cursor({ label, left, onMove }: { label: string; left: string; onMove: (fx: number) => void }) {
  const drag = useRef(false)
  return (
    <>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[3] border-l border-dashed border-gray-1000" style={{ left }} />
      <button
        type="button"
        aria-label={`Cursor ${label}, drag to move`}
        className="absolute top-1 z-[4] h-[18px] -translate-x-1/2 cursor-ew-resize rounded-kbd bg-gray-1000 px-1.5 text-xs font-medium leading-4 text-background-100"
        style={{ left }}
        onPointerDown={(e) => {
          drag.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          e.stopPropagation()
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const host = e.currentTarget.parentElement!.getBoundingClientRect()
          onMove(Math.max(0, Math.min(1, (e.clientX - host.left) / host.width)))
        }}
        onPointerUp={() => (drag.current = false)}
      >
        {label}
      </button>
    </>
  )
}
