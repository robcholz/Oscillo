import { Toaster, TooltipProvider } from '@robcholz/geist'
import { useEffect } from 'react'
import { useStore } from '../store'
import { Header } from './Header'
import { PageView } from './PageView'
import { Search } from './Search'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { useShortcuts } from './useShortcuts'

export function App() {
  useShortcuts()
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  const reduced = useStore((s) => s.reducedMotion)
  useEffect(() => {
    if (reduced) document.documentElement.dataset.motion = 'reduced'
    else delete document.documentElement.dataset.motion
  }, [reduced])
  return (
    <TooltipProvider>
      <div className="flex h-screen min-h-[600px] min-w-[960px] flex-col overflow-hidden bg-background-100 text-sm text-gray-1000">
        <Header />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <PageView />
          </main>
        </div>
        <StatusBar />
      </div>
      <Search />
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </TooltipProvider>
  )
}
