import { Toaster, TooltipProvider } from '@robcholz/geist'
import { useEffect } from 'react'
import { startDevices } from '../devices'
import { startHwSync } from '../hwsync'
import { usePrefs } from '../prefs'
import { useStore } from '../store'
import { checkAtLaunch } from '../updates'
import { openWorkspace, restoreOpened } from '../workspace'
import { Header } from './Header'
import { PageView } from './PageView'
import { Search } from './Search'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { useShortcuts } from './useShortcuts'

export function App() {
  useShortcuts()
  useEffect(() => {
    void startDevices()
    startHwSync()
    restoreOpened()
    void checkAtLaunch()
    if (usePrefs.getState().onStart === 'Open Welcome' && !sessionStorage.getItem('oscillo-started')) useStore.getState().go('welcome')
    sessionStorage.setItem('oscillo-started', '1')
    return window.oscillo?.files.onOpened((p) => void openWorkspace(p))
  }, [])
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  const animations = usePrefs((p) => p.animations)
  const fontSize = usePrefs((p) => p.fontSize)
  useEffect(() => {
    // System leaves motion to the prefers-reduced-motion media query in the stylesheet.
    if (animations === 'System') delete document.documentElement.dataset.motion
    else document.documentElement.dataset.motion = animations === 'Reduced' ? 'reduced' : 'on'
  }, [animations])
  useEffect(() => {
    // Sizes are designed at 13 px, so a larger text size scales the whole window like a zoom.
    // Viewport units are not zoomed, so the shell divides 100vh by the same factor (see below).
    const z = parseInt(fontSize) / 13
    document.documentElement.style.zoom = String(z)
    document.documentElement.style.setProperty('--app-zoom', String(z))
  }, [fontSize])
  return (
    <TooltipProvider>
      <div className="flex h-[calc(100vh/var(--app-zoom,1))] min-h-[calc(600px/var(--app-zoom,1))] min-w-[calc(960px/var(--app-zoom,1))] flex-col overflow-hidden bg-background-100 text-sm text-gray-1000">
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
