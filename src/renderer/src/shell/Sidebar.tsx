import { Tooltip, cn } from '@robcholz/geist'
import { useEffect, useState } from 'react'
import { pages, type PageInfo } from '../routes'
import { useStore } from '../store'

const groups: PageInfo['group'][] = ['Workspace', 'Instruments', 'Analysis', 'Automation', 'App']

function useWindowWidth(): number {
  const [w, setW] = useState(window.innerWidth)
  useEffect(() => {
    const on = (): void => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

/** The sidebar collapses to icons under 1100px unless the user chose otherwise (⌘B). */
export function useSidebarCollapsed(): boolean {
  const pref = useStore((s) => s.sidebarCollapsed)
  const w = useWindowWidth()
  return pref ?? w < 1100
}

export function Sidebar() {
  const page = useStore((s) => s.page)
  const go = useStore((s) => s.go)
  const c = useSidebarCollapsed()
  return (
    <nav
      aria-label="Instruments"
      className={cn(
        'flex h-full flex-none flex-col overflow-y-auto overflow-x-hidden bg-background-100 shadow-[inset_-1px_0_0_var(--gray-alpha-400)] transition-[width,padding,gap] duration-150',
        c ? 'w-14 gap-3 px-2 py-3' : 'w-52 gap-4 p-3'
      )}
    >
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-0.5">
          {c ? (
            <p aria-hidden="true" className="mx-1 mb-1.5 mt-0 h-px overflow-hidden bg-gray-alpha-400" />
          ) : (
            <p className="m-0 mb-1 whitespace-nowrap px-2 text-xs text-gray-900">{g}</p>
          )}
          {pages
            .filter((p) => p.group === g)
            .map((p) => {
              const on = p.id === page
              const Icon = p.icon
              return (
                <Tooltip key={p.id} text={p.label} keys={p.key ? ['⌘', p.key] : undefined} position="right" delay={0} disabled={!c}>
                  <button
                    type="button"
                    aria-current={on ? 'page' : undefined}
                    aria-label={c ? p.label : undefined}
                    aria-keyshortcuts={p.key ? 'Meta+' + p.key : undefined}
                    onClick={() => go(p.id)}
                    className={cn(
                      'group flex h-[30px] min-w-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-small text-sm',
                      c ? 'justify-center px-0' : 'px-2',
                      on ? 'bg-gray-100 font-medium text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000'
                    )}
                  >
                    <Icon size={16} className="flex-none" />
                    {!c && <span className="truncate">{p.label}</span>}
                    {!c && p.key && (
                      <span aria-hidden="true" className={cn('ml-auto pl-2 text-xs tabular-nums transition-colors', on ? 'text-gray-900' : 'text-gray-700 group-hover:text-gray-900')}>
                        ⌘{p.key}
                      </span>
                    )}
                  </button>
                </Tooltip>
              )
            })}
        </div>
      ))}
    </nav>
  )
}
