// A numeric field that shows a value in its display unit (e.g. seconds as µs/div), accepts SI
// suffixes ("200u", "1.5k"), and commits on Enter or blur. Invalid input shows Geist's error ring
// and reverts on Escape.
import { Input } from '@robcholz/geist'
import { useEffect, useId, useState } from 'react'

const SUFFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }

export function parseSi(text: string): number | null {
  const m = text.trim().replace(',', '.').match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([pnuµmkKMG]?)$/)
  if (!m) return null
  return Number(m[1]) * (m[2] ? SUFFIX[m[2]] : 1)
}

export interface UnitInputProps {
  label: string
  value: number
  onCommit: (v: number) => void
  /** Multiply the shown number by this to get the value (1e-6 for µs). */
  scale?: number
  suffix?: string
  min?: number
  max?: number
  decimals?: number
  integer?: boolean
  disabled?: boolean
  hideLabel?: boolean
}

export function UnitInput({ label, value, onCommit, scale = 1, suffix, min, max, decimals, integer, disabled, hideLabel }: UnitInputProps) {
  const id = useId()
  const show = (v: number): string => {
    const x = v / scale
    if (decimals != null) return x.toFixed(decimals)
    return String(Number(x.toPrecision(6)))
  }
  const [text, setText] = useState(show(value))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setText(show(value))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, scale])
  const commit = (): void => {
    const n = parseSi(text)
    if (n === null) return setError('Enter a number')
    const v = n * scale
    if (integer && !Number.isInteger(n)) return setError('Enter a whole number')
    if (min != null && v < min) return setError(`At least ${show(min)}${suffix ? ' ' + suffix : ''}`)
    if (max != null && v > max) return setError(`At most ${show(max)}${suffix ? ' ' + suffix : ''}`)
    setError(null)
    if (v !== value) onCommit(v)
    else setText(show(value))
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-[13px] leading-4 text-gray-900'}>
        {label}
      </label>
      <Input
        id={id}
        size="small"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        title={error ?? undefined}
        error={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          if (error) setError(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setText(show(value))
            setError(null)
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const n = parseSi(text)
            if (n === null) return
            e.preventDefault()
            const step = integer ? 1 : Math.abs(n) >= 10 ? 1 : 0.1
            const next = (n + (e.key === 'ArrowUp' ? step : -step)) * scale
            if ((min == null || next >= min) && (max == null || next <= max)) onCommit(next)
          }
        }}
        suffix={suffix ? <span className="text-[13px] text-gray-700">{suffix}</span> : undefined}
      />
      {error && <span className="text-[13px] leading-4 text-red-900">{error}</span>}
    </div>
  )
}
