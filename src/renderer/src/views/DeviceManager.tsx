// Device Manager (board: DeviceManager). Connect, rename and configure devices, connection options,
// the buffer configuration and dual device mode.
import { Button, ChoiceboxGroup, Note, DotsMenu, EmptyState, Entity, Fieldset, FormModal, Material, MenuItem, MenuSeparator, Select, StatusDot, Toggle, type FormField } from '@robcholz/geist'
import { Cpu, ExternalLink, FlaskConical, Lock, Network, Pencil, Plus, RefreshCw, Ruler, Settings, Trash2, Usb } from 'lucide-react'
import { useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { LabeledSelect, OptionRow, PageBar, ScrollPage } from '../components/Page'
import { CONFIGS, connectDevice, refreshDevices, useDevices, type DeviceId } from '../devices'
import { useStore } from '../store'

interface DMState {
  names: Partial<Record<DeviceId, string>>
  autoRefresh: boolean
  autoReconnect: boolean
  extra: { id: string; name: string; ip: string }[]
  set: (p: Partial<Omit<DMState, 'set'>>) => void
}
const useDM = create<DMState>()(
  persist((set) => ({ names: {}, autoRefresh: true, autoReconnect: true, extra: [], set: (p) => set(p) }), { name: 'oscillo.devices', partialize: ({ set: _s, ...r }) => r })
)

const linkIcon = { USB: <Usb size={16} />, LAN: <Network size={16} />, SIM: <FlaskConical size={16} /> }
const linkName = { USB: 'USB', LAN: 'Network', SIM: 'Demo' }

export function DeviceManager() {
  const s = useStore()
  const dm = useDM()
  const toast = s.toast
  const [filter, setFilter] = useState('All')
  const scanning = useDevices((d) => d.scanning)
  const all = useDevices((d) => d.list)
  const sdk = useDevices((d) => d.status)
  const [config, setConfig] = useState(s.config)
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void; description?: string }>(null)
  const [pair, setPair] = useState({ primary: 'Analog Discovery 3', secondary: 'Digital Discovery' })

  const list = all.filter((d) => filter === 'All' || linkName[d.link] === filter)
  const extra = dm.extra.filter(() => filter === 'All' || filter === 'Network')
  const name = (id: DeviceId) => dm.names[id] ?? all.find((d) => d.id === id)?.name ?? id

  const refresh = async () => {
    const found = await refreshDevices()
    const real = found.filter((d) => d.link !== 'SIM').length
    toast('Scan finished', { detail: real ? `${real} ${real === 1 ? 'device' : 'devices'} found, plus the Demo Device.` : 'No devices found. The Demo Device is always available.' })
  }
  const connect = (id: DeviceId) => void connectDevice(id)

  return (
    <ScrollPage
      className="flex max-w-[1040px] flex-col gap-6 p-6!"
      bar={
        <PageBar title="Device Manager">
          <div className="w-[136px]">
            <Select size="small" aria-label="Filter Devices" value={filter} options={['All', 'USB', 'Network', 'Demo']} onValueChange={setFilter} />
          </div>
          <Button size="small" type="secondary" prefix={<RefreshCw size={16} className={scanning ? 'animate-spin' : undefined} />} disabled={scanning} onClick={() => void refresh()}>
            {scanning ? 'Scanning' : 'Refresh'}
          </Button>
        </PageBar>
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-xl font-semibold leading-[26px] tracking-[-0.4px]">Devices</h2>
        <Button
          size="small"
          type="tertiary"
          prefix={<Plus size={16} />}
          onClick={() =>
            setDialog({
              title: 'Add Network Device',
              description: 'Analog Discovery Pro devices can connect over Ethernet.',
              submitLabel: 'Add Device',
              fields: [
                { key: 'ip', label: 'IP Address', placeholder: '192.168.1.41', required: true, mono: true, validate: (v) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(v) ? null : 'Enter an IPv4 address, such as 192.168.1.41.') },
                { key: 'n', label: 'Name', placeholder: 'Bench 2', required: false }
              ],
              onSubmit: (v) => {
                dm.set({ extra: [...dm.extra, { id: v.ip, name: v.n || 'Analog Discovery Pro', ip: v.ip }] })
                toast('Network device added', { detail: `${v.ip} will show as Available when it answers.` })
              }
            })
          }
        >
          Add Network Device
        </Button>
      </div>
      {sdk && !sdk.library && (
        <Note type="secondary" size="small">
          WaveForms isn’t installed on this Mac, so only the Demo Device is available. Install WaveForms from digilent.com to use a real device.
        </Note>
      )}
      <Material>
        {list.map((d, i) => {
          const on = s.device === d.id
          return (
            <Entity key={d.id} title={name(d.id)} description={`${linkName[d.link]} · ${d.serial}`} icon={linkIcon[d.link]} className={i === list.length - 1 && !extra.length ? 'shadow-none' : undefined}>
              <StatusDot state={on ? 'READY' : d.busy ? 'CANCELED' : 'QUEUED'} label={on ? 'Connected' : d.busy ? 'In Use' : 'Available'} />
              <Button size="small" type={on ? 'secondary' : 'primary'} disabled={!on && d.busy} onClick={() => (on ? void connectDevice(null) : connect(d.id))}>
                {on ? 'Disconnect' : 'Connect'}
              </Button>
              <DotsMenu
                aria-label={`${name(d.id)} Actions`}
                menu={
                  <>
                    <MenuItem prefix={<Pencil size={16} />} onSelect={() => setDialog({ title: 'Rename Device', submitLabel: 'Rename', fields: [{ key: 'n', label: 'Name', value: name(d.id), required: true }], onSubmit: (v) => dm.set({ names: { ...dm.names, [d.id]: v.n } }) })}>
                      Rename Device
                    </MenuItem>
                    <MenuItem prefix={<Ruler size={16} />} onSelect={() => { if (!on) connect(d.id); s.go('calibration') }}>Calibrate</MenuItem>
                    <MenuItem prefix={<Settings size={16} />} onSelect={() => { if (!on) connect(d.id); s.go('device-options') }}>Device Options</MenuItem>
                    <MenuItem prefix={<ExternalLink size={16} />} onSelect={() => toast('Opened in a new window', { detail: `${name(d.id)} runs in its own window with its own workspace.` })}>Open in New Window</MenuItem>
                  </>
                }
              />
            </Entity>
          )
        })}
        {extra.map((d, i) => (
          <Entity key={d.id} title={d.name} description={`Network · ${d.ip}`} icon={<Network size={16} />} className={i === extra.length - 1 ? 'shadow-none' : undefined}>
            <StatusDot state="CANCELED" label="Not Responding" />
            <Button size="small" type="secondary" onClick={() => toast(`${d.ip} is not responding`, { detail: 'Check that the device is on and on the same network, then press Refresh.' })}>
              Connect
            </Button>
            <DotsMenu
              aria-label={`${d.name} Actions`}
              menu={
                <>
                  <MenuItem prefix={<Settings size={16} />} onSelect={() => toast('Network settings', { detail: `${d.ip}, DHCP, port 6000.` })}>Network Settings</MenuItem>
                  <MenuItem prefix={<Lock size={16} />} onSelect={() => setDialog({ title: 'Set Password', submitLabel: 'Set Password', fields: [{ key: 'p', label: 'Password', required: true }], onSubmit: () => toast('Password saved') })}>Set Password</MenuItem>
                  <MenuSeparator />
                  <MenuItem danger prefix={<Trash2 size={16} />} onSelect={() => { dm.set({ extra: dm.extra.filter((x) => x.id !== d.id) }); toast(`Forgot ${d.ip}`) }}>Forget Device</MenuItem>
                </>
              }
            />
          </Entity>
        ))}
        {list.length + extra.length === 0 && (
          <div className="p-6">
            <EmptyState title="No Matching Devices" description="No devices match this filter." icon={<Usb size={20} />} action={<Button size="small" type="secondary" onClick={() => setFilter('All')}>Show All Devices</Button>} />
          </div>
        )}
      </Material>

      <Fieldset title="Connection" subtitle="How Oscillo finds devices and keeps them connected." bodyClassName="gap-0">
        <OptionRow label="Auto Refresh" description="Scan USB and the local network for devices every 2 seconds.">
          <Toggle checked={dm.autoRefresh} aria-label="Auto Refresh" onChange={(autoRefresh) => dm.set({ autoRefresh })} />
        </OptionRow>
        <OptionRow label="Auto Reconnect" description="Reconnect to the last device when it is unplugged and comes back.">
          <Toggle checked={dm.autoReconnect} aria-label="Auto Reconnect" onChange={(autoReconnect) => dm.set({ autoReconnect })} />
        </OptionRow>
      </Fieldset>

      <Fieldset
        title="Configuration"
        subtitle={`Buffer memory split between instruments for ${s.device ? name(s.device) : 'the connected device'}. Applying it reconnects the device.`}
        footer={config === s.config ? `Using ${CONFIGS.find((c) => c.value === s.config)?.label}.` : 'Applying briefly stops every instrument.'}
        actions={
          <Button size="small" disabled={config === s.config || !s.device} onClick={async () => { s.setConfig(config); if (await connectDevice(s.device, { quiet: true })) toast('Configuration applied', { detail: `${CONFIGS.find((c) => c.value === config)?.label}. The device reconnected.` }) }}>
            Apply Configuration
          </Button>
        }
      >
        <ChoiceboxGroup aria-label="Configuration" columns={2} value={config} onChange={setConfig} options={CONFIGS.map((c) => ({ value: c.value, label: c.label, description: c.description }))} />
      </Fieldset>

      <Fieldset
        title="Dual Device Mode"
        subtitle="Control two devices from one workspace with shared triggers."
        footer="Both devices must be on USB."
        actions={
          <Button size="small" type="secondary" prefix={<Cpu size={16} />} onClick={() => toast('Devices paired', { detail: `${pair.primary} leads, ${pair.secondary} follows its trigger.` })}>
            Pair Devices
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <LabeledSelect label="Primary" value={pair.primary} options={['Analog Discovery 3']} onValueChange={(primary) => setPair({ ...pair, primary })} />
          <LabeledSelect label="Secondary" value={pair.secondary} options={['Digital Discovery', 'Analog Discovery Pro 3450']} onValueChange={(secondary) => setPair({ ...pair, secondary })} />
        </div>
      </Fieldset>
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </ScrollPage>
  )
}
