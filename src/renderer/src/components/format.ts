// Engineering notation for readouts: 0.000047 s → "47.0 µs", 4096000 → "4.096 M". The decimal
// symbol follows Settings → Language and Region.
import { usePrefs } from '../prefs'

let comma = false
const sync = () => {
  const d = usePrefs.getState().decimal
  comma = d === 'Comma' || (d === 'Locale' && (0.5).toLocaleString().includes(','))
}
sync()
usePrefs.subscribe(sync)
/** Swaps the decimal point for a comma when Settings ask for one. */
export const dec = (txt: string): string => (comma ? txt.replace('.', ',') : txt)
const prefixes: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p']
]

export function si(value: number, unit = '', digits = 3): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0' + (unit ? ' ' + unit : '')
  const a = Math.abs(value)
  const [f, p] = prefixes.find(([f]) => a >= f * 0.9995) ?? prefixes[prefixes.length - 1]
  const v = value / f
  const s = v.toPrecision(digits)
  // toPrecision can give "1.00e+3"; fall back to fixed in that case.
  const txt = s.includes('e') ? v.toFixed(0) : s
  return dec(txt) + (unit || p ? ' ' + p + unit : '')
}

/** Fixed decimals with a unit, e.g. fixed(1.9023, 'V', 3) → "1.902 V". */
export function fixed(value: number, unit = '', decimals = 3): string {
  if (!Number.isFinite(value)) return '—'
  const txt = value.toFixed(decimals)
  return dec(/^-0\.?0*$/.test(txt) ? txt.slice(1) : txt) + (unit ? ' ' + unit : '')
}

/** Axis tick label: the ends carry the unit, the inner ticks don't. */
export function tick(value: number, unit: string, end: boolean): string {
  const s = si(value, end ? unit : '', 3).replace(/[.,]0+(\s|$)/, '$1').replace(/([.,]\d*?)0+(\s|$)/, '$1$2')
  return s.trim()
}

/** Axis ticks in one scale: the ends read "-1 ms" / "1 ms", inner ticks "-0.6", "0.2" in the same unit. */
export function axisTicks(values: number[], unit: string): string[] {
  const big = Math.max(...values.map(Math.abs))
  if (!big) return values.map(() => '0')
  const [f, p] = prefixes.find(([f]) => big >= f * 0.9995) ?? prefixes[prefixes.length - 1]
  const step = values.length > 1 ? Math.abs(values[1] - values[0]) / f : 1
  const places = Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9)))
  return values.map((v, i) => {
    const n = v / f
    const txt = Math.abs(n) < 1e-9 ? '0' : dec(n.toFixed(places).replace(/\.0+$/, ''))
    return i === 0 || i === values.length - 1 ? `${txt} ${p}${unit}` : txt
  })
}
