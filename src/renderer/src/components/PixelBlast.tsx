import { cn } from '@robcholz/geist'
import { useEffect, useRef } from 'react'
import { mountPixelBlast, WELCOME_BLAST, type PixelBlastOptions } from './pixelBlastEngine'

/** Animated pixel field that fills its parent (position it yourself). Purely decorative. */
export function PixelBlast({ className, options = WELCOME_BLAST }: { className?: string; options?: PixelBlastOptions }) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!host.current || !canvas.current) return
    return mountPixelBlast(host.current, canvas.current, options)
  }, [options])
  return (
    <div ref={host} aria-hidden="true" className={cn('pointer-events-none', className)}>
      <canvas ref={canvas} className="absolute inset-0 block size-full" />
    </div>
  )
}
