// The few glyphs Geist components draw themselves (Lucide shapes, ISC). Apps bring their own icon set.
import type { ReactNode } from 'react'

function Glyph({ size = 16, strokeWidth = 2, children }: { size?: number; strokeWidth?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      {children}
    </svg>
  )
}

export const CheckGlyph = (p: { size?: number; strokeWidth?: number }) => <Glyph {...p}><path d="M20 6 9 17l-5-5" /></Glyph>
export const MinusGlyph = (p: { size?: number; strokeWidth?: number }) => <Glyph {...p}><path d="M5 12h14" /></Glyph>
export const ChevronDownGlyph = (p: { size?: number }) => <Glyph {...p}><path d="m6 9 6 6 6-6" /></Glyph>
export const EllipsisGlyph = (p: { size?: number }) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </Glyph>
)
export const InfoGlyph = (p: { size?: number }) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Glyph>
)
export const CircleCheckGlyph = (p: { size?: number }) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </Glyph>
)
export const CircleAlertGlyph = (p: { size?: number }) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" x2="12" y1="8" y2="12" />
    <line x1="12" x2="12.01" y1="16" y2="16" />
  </Glyph>
)
export const TriangleAlertGlyph = (p: { size?: number }) => (
  <Glyph {...p}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Glyph>
)
export const CopyGlyph = (p: { size?: number }) => (
  <Glyph {...p}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Glyph>
)
export const XGlyph = (p: { size?: number }) => <Glyph {...p}><path d="M18 6 6 18M6 6l12 12" /></Glyph>
