import { useEffect, useRef } from 'react'

/** Calls fn every `ms` while `active`; the latest fn is always used. */
export function useInterval(fn: () => void, ms: number, active = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => ref.current(), ms)
    return () => clearInterval(t)
  }, [ms, active])
}

/** Small gaussian-ish noise for simulated readings. */
export const jitter = (amount: number) => (Math.random() + Math.random() + Math.random() - 1.5) * amount
