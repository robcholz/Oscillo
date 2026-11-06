// TypeScript highlighting for one line, and a plain code editor with a line-number gutter.
import { cn } from '@robcholz/geist'
import { useRef, type ReactNode } from 'react'

const KEYWORDS = new Set(
  'import export from const let var for of in if else while return await async function new class extends interface type declare module true false null undefined this break continue try catch throw typeof as'.split(' ')
)
const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g

/** Highlights one line of TypeScript. Template strings that span lines are coloured line by line. */
export function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of line.matchAll(TOKEN)) {
    const i = m.index ?? 0
    if (i > last) out.push(line.slice(last, i))
    const [text, comment, str, num, call, word] = m
    const cls = comment ? 'text-gray-800 italic' : str ? 'text-green-900' : num ? 'text-amber-900' : call ? 'text-blue-900' : word && KEYWORDS.has(word) ? 'text-pink-900' : word && /^[A-Z]/.test(word) ? 'text-purple-900' : ''
    out.push(cls ? (
      <span key={i} className={cls}>
        {text}
      </span>
    ) : (
      text
    ))
    last = i + text.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

/** A monospace editor: line numbers on the left, Tab indents by two spaces. */
export function CodeEditor({ value, onChange, label, className }: { value: string; onChange: (v: string) => void; label: string; className?: string }) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const n = value.split('\n').length
  return (
    <div className={cn('flex min-h-0 overflow-hidden rounded-small bg-background-100 font-mono text-[13px] leading-5 shadow-[0_0_0_1px_var(--gray-alpha-400)] focus-within:shadow-focus-ring', className)}>
      <div ref={gutter} aria-hidden className="w-12 flex-none select-none overflow-hidden py-3 pr-3 text-right text-gray-700">
        {Array.from({ length: n }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={ta}
        aria-label={label}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
        onKeyDown={(e) => {
          if (e.key !== 'Tab' || e.shiftKey) return
          e.preventDefault()
          const el = e.currentTarget
          const { selectionStart: s, selectionEnd: t } = el
          onChange(value.slice(0, s) + '  ' + value.slice(t))
          requestAnimationFrame(() => ta.current?.setSelectionRange(s + 2, s + 2))
        }}
        className="min-w-0 flex-1 resize-none whitespace-pre bg-transparent py-3 pr-3 text-gray-1000 caret-gray-1000 outline-none"
      />
    </div>
  )
}
