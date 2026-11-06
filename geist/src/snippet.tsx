// Geist Snippet (https://vercel.com/geist/snippet): a command with a copy button.
import { useState } from 'react'
import { Button } from './button'
import { cn } from './cn'
import { CheckGlyph, CopyGlyph } from './icons'

export interface SnippetProps {
  text: string | string[]
  /** Prompt shown before each line; false for none. */
  prompt?: string | false
  dark?: boolean
  onCopy?: () => void
  className?: string
}

export function Snippet({ text, prompt = '$', dark, onCopy, className }: SnippetProps) {
  const [copied, setCopied] = useState(false)
  const lines = Array.isArray(text) ? text : [text]
  return (
    <div className={cn('flex min-w-0 items-center gap-2 rounded-small py-1 pl-3 pr-1 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]', dark ? 'bg-gray-1000' : 'bg-background-100', className)}>
      <pre className="m-0 flex min-w-0 flex-1 flex-col overflow-x-auto">
        {lines.map((l, i) => (
          <code key={i} className={cn('whitespace-pre font-mono text-[13px] leading-5', dark ? 'text-background-100' : 'text-gray-1000')}>
            {prompt && <span className="select-none text-gray-700">{prompt} </span>}
            {l}
          </code>
        ))}
      </pre>
      <Button
        type="tertiary"
        size="small"
        svgOnly
        aria-label="Copy"
        tooltip={copied ? 'Copied' : 'Copy'}
        onClick={() => {
          void navigator.clipboard?.writeText(lines.join('\n'))
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
          onCopy?.()
        }}
      >
        {copied ? <CheckGlyph size={14} /> : <CopyGlyph size={14} />}
      </Button>
    </div>
  )
}
