// Runs app commands from the menu bar (see src/shared/commands.ts). Pages register the commands
// that only make sense while they are open: Single and Auto Set on the Scope, Undo and Redo in
// the wave and pattern editors, the settings panel on split pages.
import { useEffect, useRef } from 'react'
import type { AppCommand } from '../../../shared/commands'

const handlers = new Map<AppCommand, (() => void)[]>()

/** Runs `fn` for `cmd` while the calling component is mounted (the latest one wins). */
export function useCommand(cmd: AppCommand, fn: () => void, enabled = true): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    const h = () => ref.current()
    handlers.set(cmd, [...(handlers.get(cmd) ?? []), h])
    return () => void handlers.set(cmd, (handlers.get(cmd) ?? []).filter((x) => x !== h))
  }, [cmd, enabled])
}

const editing = (): boolean => {
  const t = document.activeElement as HTMLElement | null
  return !!t && (t.isContentEditable || /^(input|textarea)$/i.test(t.tagName))
}

/** Runs a page's handler for `cmd`. Returns false when no page handles it. */
export function runPageCommand(cmd: AppCommand): boolean {
  // Text fields keep their own undo history.
  if ((cmd === 'undo' || cmd === 'redo') && editing()) {
    document.execCommand(cmd)
    return true
  }
  const list = handlers.get(cmd)
  if (!list?.length) return false
  list[list.length - 1]()
  return true
}

/** The command a key press means, for the plain-browser build where there is no menu bar. */
export function commandForKey(e: KeyboardEvent): AppCommand | null {
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return null
  const k = e.key.toLowerCase()
  if (e.altKey) return e.code === 'Digit0' ? 'toggle-panel' : null
  if (e.shiftKey) return k === 'l' ? 'toggle-theme' : k === 'a' ? 'auto-set' : k === 'z' ? 'redo' : null
  const plain: Record<string, AppCommand> = { k: 'search', s: 'save-workspace', o: 'open-workspace', b: 'toggle-sidebar', r: 'run-script', z: 'undo', enter: 'single', ',': 'settings' }
  return plain[k] ?? null
}
