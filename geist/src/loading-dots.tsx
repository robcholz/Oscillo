// Geist Loading Dots (https://vercel.com/geist/loading-dots).
import type { ReactNode } from 'react'

export function LoadingDots({ size = 4, children }: { size?: number; children?: ReactNode }) {
  return (
    <span role="status" aria-label="Loading" className="inline-flex items-center gap-1 text-sm text-gray-1000">
      {children && <span className="mr-1">{children}</span>}
      {[0, 0.2, 0.4].map((d) => (
        <span key={d} className="rounded-full bg-gray-1000" style={{ width: size, height: size, animation: `geist-blink 1.4s ${d}s infinite both` }} />
      ))}
    </span>
  )
}
