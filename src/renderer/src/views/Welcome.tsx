// Welcome (board: Welcome). The page Oscillo opens on: a Pixel Blast field behind the title, the workspace
// actions and a Recent Workspaces card, all on one screen that never scrolls. Short windows (the 960 x 600
// minimum) drop the icon and descriptions so the page still fits.
import { Button, FormModal, Kbd, Material, StatusDot } from '@robcholz/geist'
import { ChevronRight, Folder, FolderOpen, Plus } from 'lucide-react'
import { useState } from 'react'
import icon from '../assets/oscillo-icon.png'
import { PixelBlast } from '../components/PixelBlast'
import { useDevice } from '../devices'
import { useStore } from '../store'
import { newWorkspace, openWorkspace, useRecent } from '../workspace'

const when = (at: number): string => {
  const d = new Date(at)
  const today = new Date()
  const days = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return days === 0 ? `Today, ${time}` : days === 1 ? 'Yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
const home = (p: string): string => p.replace(/^\/(Users|home)\/[^/]+/, '~')

export function Welcome() {
  const s = useStore()
  const [create, setCreate] = useState(false)
  const dev = useDevice()
  const recent = useRecent((r) => r.recent)

  return (
    <section aria-labelledby="welcome-title" className="relative isolate flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 py-6 *:flex-none">
      <PixelBlast className="welcome-blast absolute inset-0 -z-10" />
      <div className="flex flex-col items-center text-center">
        <Button size="small" type="secondary" shape="rounded" suffix={<ChevronRight size={16} />} onClick={() => s.go('device')} className="mb-6 [@media(max-height:780px)]:mb-4">
          <span className="inline-flex items-center gap-2">
            <StatusDot state={dev ? 'READY' : 'ERROR'} />
            {dev ? dev.name : 'No device'}
            <span className="text-gray-900">{dev ? 'Connected' : 'Connect'}</span>
          </span>
        </Button>
        <img src={icon} width={64} height={64} alt="" className="mb-4 block [@media(max-height:780px)]:hidden" draggable={false} />
        <h1 id="welcome-title" className="m-0 text-5xl leading-14 font-semibold tracking-[-2.88px] [@media(max-height:780px)]:text-[32px] [@media(max-height:780px)]:leading-10 [@media(max-height:780px)]:tracking-[-1.28px]">
          Oscillo
        </h1>
        <p className="m-0 mt-2 text-base leading-6 text-gray-900">Measure, generate and decode signals with your Digilent instrument.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3 [@media(max-height:780px)]:mt-5">
          <Button prefix={<Plus size={16} />} onClick={() => setCreate(true)}>
            New Workspace
          </Button>
          <Button type="secondary" prefix={<FolderOpen size={16} />} onClick={() => void openWorkspace()}>
            Open Workspace
          </Button>
        </div>
      </div>

      <Material className="mt-8 w-full max-w-[560px] overflow-hidden [@media(max-height:780px)]:mt-5">
        <h2 className="m-0 flex h-11 items-center px-4 text-sm leading-5 font-semibold tracking-[-0.28px] shadow-[inset_0_-1px_0_var(--gray-alpha-400)]">Recent Workspaces</h2>
        {recent.length > 0 ? (
          <ul className="m-0 flex max-h-[272px] list-none flex-col overflow-y-auto p-1.5 [@media(max-height:780px)]:max-h-[188px]">
            {recent.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  title={home(r.path)}
                  onClick={() => void openWorkspace(r.path)}
                  className="flex h-[52px] w-full min-w-0 items-center gap-3 rounded-small px-2.5 text-left outline-none hover:bg-gray-alpha-100 kbd-focus:shadow-focus-ring [@media(max-height:780px)]:h-11"
                >
                  <span className="flex size-8 flex-none items-center justify-center rounded-small text-gray-1000 shadow-[inset_0_0_0_1px_var(--gray-alpha-400)]">
                    <Folder size={16} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm leading-5 font-medium">{r.name}</span>
                    {r.device && <span className="truncate text-[13px] leading-4 text-gray-900 [@media(max-height:780px)]:hidden">{r.device}</span>}
                  </span>
                  <span className="flex-none text-xs leading-4 text-gray-900">{when(r.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-1 px-4 py-7 text-center">
            <span className="text-sm leading-5 font-medium">No recent workspaces</span>
            <span className="text-[13px] leading-[18px] text-gray-900">Workspaces you save or open show here. Press ⌘S to save this one.</span>
          </div>
        )}
      </Material>

      <p className="m-0 mt-5 flex items-center gap-1.5 text-[13px] leading-4 text-gray-900 [@media(max-height:780px)]:mt-3">
        Press <Kbd small meta keys={['K']} /> to find any instrument or setting
      </p>
      <FormModal
        open={create}
        onClose={() => setCreate(false)}
        title="New Workspace"
        description="Every instrument starts from its default settings. Save the current workspace first if you want to keep it."
        fields={[{ key: 'n', label: 'Name', placeholder: 'Bench Tests', required: true }]}
        submitLabel="Create Workspace"
        onSubmit={(v) => newWorkspace(v.n.trim())}
      />
    </section>
  )
}
