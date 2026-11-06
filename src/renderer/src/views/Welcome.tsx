// Welcome (board: Welcome). Instrument launcher and recent workspaces.
import { Banner, Button, FormModal, Material, Pill, Table } from '@robcholz/geist'
import { FolderOpen, Info, Plus, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { PageBar, ScrollPage } from '../components/Page'
import { devices } from '../devices'
import { pageById, type PageId } from '../routes'
import { useStore } from '../store'

const LAUNCH: { id: PageId; text: string }[] = [
  { id: 'scope', text: 'Oscilloscope with triggers, math and measurements' },
  { id: 'wavegen', text: 'Function, custom, sweep and modulated signals' },
  { id: 'supplies', text: 'Positive and negative rails' },
  { id: 'logic', text: 'Digital capture with SPI, I2C, UART and CAN decoding' },
  { id: 'patterns', text: 'Clocks, pulses, counters and custom data' },
  { id: 'spectrum', text: 'FFT and CZT with SNR, THD and ENOB' },
  { id: 'network', text: 'Bode, Nyquist and Nichols' },
  { id: 'script', text: 'Automate any instrument in TypeScript' }
]

const RECENT = [
  { n: 'Audio Amp Bring-Up', p: '~/Projects/amp', d: 'Analog Discovery 3', m: 'Today, 11:42', shared: false },
  { n: 'SPI Flash Debug', p: '~/Projects/flash', d: 'Digital Discovery', m: 'Yesterday', shared: false },
  { n: 'Filter Lab', p: 'Team / EE 230', d: 'Analog Discovery 3', m: 'Nov 3', shared: true },
  { n: 'Motor Driver Tests', p: 'Team / Robotics', d: 'Analog Discovery Pro 3450', m: 'Oct 28', shared: true },
  { n: 'Untitled', p: '~/Documents', d: 'Demo Device', m: 'Oct 21', shared: false }
]

export function Welcome() {
  const s = useStore()
  const [filter, setFilter] = useState<'all' | 'device' | 'shared'>('all')
  const [banner, setBanner] = useState(true)
  const [create, setCreate] = useState(false)
  const dev = s.device ? devices[s.device] : null
  const rows = RECENT.filter((r) => (filter === 'shared' ? r.shared : filter === 'device' ? !!dev && r.d === dev.name : true))

  const open = (name: string) => {
    s.setWorkspace(name)
    s.go('scope')
    s.toast(`Opened ${name}`)
  }

  return (
    <ScrollPage
      className="p-0!"
      bar={
        <PageBar title="Welcome">
          <Button size="small" type="secondary" prefix={<FolderOpen size={16} />} onClick={() => open('Filter Lab')}>
            Open Workspace
          </Button>
          <Button size="small" prefix={<Plus size={16} />} onClick={() => setCreate(true)}>
            New Workspace
          </Button>
        </PageBar>
      }
    >
      {banner &&
        (dev ? (
          <Banner icon={<Info size={16} />} onClose={() => setBanner(false)} action={<Button size="small" type="secondary" onClick={() => s.go('scope')}>Open Scope</Button>}>
            {dev.name} is connected and ready.
          </Banner>
        ) : (
          <Banner type="warning" icon={<TriangleAlert size={16} />} onClose={() => setBanner(false)} action={<Button size="small" type="secondary" onClick={() => s.go('device')}>Connect</Button>}>
            No device connected. Connect one, or use the Demo Device to try every instrument.
          </Banner>
        ))}
      <div className="flex max-w-[1120px] flex-col gap-6 p-6">
        <h2 className="m-0 text-xl font-semibold leading-[26px] tracking-[-0.4px]">Open an Instrument</h2>
        <Material className="grid grid-cols-[repeat(auto-fit,minmax(max(180px,25%),1fr))] overflow-hidden">
          {LAUNCH.map(({ id, text }) => {
            const p = pageById[id]
            const Icon = p.icon
            return (
              <button key={id} type="button" onClick={() => s.go(id)} className="flex items-start gap-3 p-6 text-left shadow-[inset_-1px_-1px_0_var(--gray-alpha-400)] transition-colors hover:bg-gray-alpha-100">
                <Icon size={20} />
                <span className="flex flex-col gap-1">
                  <span className="text-sm font-semibold leading-5 tracking-[-0.28px]">{p.label}</span>
                  <span className="text-[13px] leading-[18px] text-gray-900">{text}</span>
                </span>
              </button>
            )
          })}
        </Material>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-xl font-semibold leading-[26px] tracking-[-0.4px]">Recent Workspaces</h2>
          <div className="flex gap-2">
            <Pill size="small" active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </Pill>
            <Pill size="small" active={filter === 'device'} onClick={() => setFilter('device')}>
              This Device
            </Pill>
            <Pill size="small" active={filter === 'shared'} onClick={() => setFilter('shared')}>
              Shared
            </Pill>
          </div>
        </div>
        <Table
          caption="Recent workspaces"
          columns={[
            { key: 'n', title: 'Name' },
            { key: 'p', title: 'Location' },
            { key: 'd', title: 'Device' },
            { key: 'm', title: 'Modified', align: 'right' }
          ]}
          rows={rows}
          rowKey={(r) => r.n}
          onRowClick={(r) => open(r.n)}
        />
        {rows.length === 0 && <p className="m-0 text-sm text-gray-900">{filter === 'device' ? 'No workspaces were saved with this device yet.' : 'No shared workspaces.'}</p>}
      </div>
      <FormModal
        open={create}
        onClose={() => setCreate(false)}
        title="New Workspace"
        fields={[
          { key: 'n', label: 'Name', placeholder: 'Bench Tests', required: true },
          { key: 'p', label: 'Location', value: '~/Documents', required: true }
        ]}
        submitLabel="Create Workspace"
        onSubmit={(v) => open(v.n)}
      />
    </ScrollPage>
  )
}
