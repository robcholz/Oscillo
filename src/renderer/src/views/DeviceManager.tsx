// Device Manager (board: DeviceManager). Connect, rename and configure devices, connection options,
// and the buffer configuration.
import { Button, ChoiceboxGroup, Note, DotsMenu, EmptyState, Entity, Fieldset, FormModal, Material, MenuItem, Select, StatusDot, Toggle, type FormField } from '@robcholz/geist'
import { FlaskConical, Network, Pencil, RefreshCw, Ruler, Settings, Usb } from 'lucide-react'
import { useState } from 'react'
import { OptionRow, PageBar, ScrollPage } from '../components/Page'
import { CONFIGS, connectDevice, refreshDevices, useDeviceSettings, useDevices, type DeviceId } from '../devices'
import { useStore } from '../store'


const linkIcon = { USB: <Usb size={16} />, LAN: <Network size={16} />, SIM: <FlaskConical size={16} /> }
const linkName = { USB: 'USB', LAN: 'Network', SIM: 'Demo' }

export function DeviceManager() {
  const s = useStore()
  const dm = useDeviceSettings()
  const toast = s.toast
  const [filter, setFilter] = useState('All')
  const scanning = useDevices((d) => d.scanning)
  const all = useDevices((d) => d.list)
  const sdk = useDevices((d) => d.status)
  const [config, setConfig] = useState(s.config)
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void; description?: string }>(null)

  const list = all.filter((d) => filter === 'All' || linkName[d.link] === filter)
  const name = (id: DeviceId) => all.find((d) => d.id === id)?.name ?? id

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
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-xl font-semibold leading-[26px] tracking-[-0.4px]">Devices</h2>
        <p className="m-0 text-[13px] leading-[18px] text-gray-900">USB devices, and Analog Discovery Pro devices on this network, appear here.</p>
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
            <Entity key={d.id} title={name(d.id)} description={`${linkName[d.link]} · ${d.serial}`} icon={linkIcon[d.link]} className={i === list.length - 1 ? 'shadow-none' : undefined}>
              <StatusDot state={on ? 'READY' : d.busy ? 'CANCELED' : 'QUEUED'} label={on ? 'Connected' : d.busy ? 'In Use' : 'Available'} />
              <Button size="small" type={on ? 'secondary' : 'primary'} disabled={!on && d.busy} onClick={() => (on ? void connectDevice(null) : connect(d.id))}>
                {on ? 'Disconnect' : 'Connect'}
              </Button>
              <DotsMenu
                aria-label={`${name(d.id)} Actions`}
                menu={
                  <>
                    <MenuItem prefix={<Pencil size={16} />} onSelect={() => setDialog({ title: 'Rename Device', submitLabel: 'Rename', fields: [{ key: 'n', label: 'Name', value: name(d.id), required: true }], onSubmit: (v) => { dm.set({ names: { ...dm.names, [d.id]: v.n.trim() } }); void refreshDevices() } })}>
                      Rename Device
                    </MenuItem>
                    <MenuItem prefix={<Ruler size={16} />} onSelect={() => { if (!on) connect(d.id); s.go('calibration') }}>Calibrate</MenuItem>
                    <MenuItem prefix={<Settings size={16} />} onSelect={() => { if (!on) connect(d.id); s.go('device-options') }}>Device Options</MenuItem>
                  </>
                }
              />
            </Entity>
          )
        })}
        {list.length === 0 && (
          <div className="p-6">
            <EmptyState title="No Matching Devices" description="No devices match this filter." icon={<Usb size={20} />} action={<Button size="small" type="secondary" onClick={() => setFilter('All')}>Show All Devices</Button>} />
          </div>
        )}
      </Material>

      <Fieldset title="Connection" subtitle="How Oscillo finds devices and keeps them connected." bodyClassName="gap-0">
        <OptionRow label="Auto Refresh" description="Look for devices plugged in or unplugged every 3 seconds.">
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

      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </ScrollPage>
  )
}
