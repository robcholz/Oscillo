// Device Options (board: DeviceOptions). Power, clocking, digital I/O and trigger settings for the
// connected device, plus a live system monitor.
import { Button, Fieldset, Note, Select, Slider, Switch, Table, Toggle } from '@robcholz/geist'
import { RefreshCw } from 'lucide-react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { OptionRow, PageBar, ScrollPage } from '../components/Page'
import { UnitInput } from '../components/UnitInput'
import type { OptionsReply, OptionsRequest } from '../../../shared/hw'
import { hw, useDevice, useHardware } from '../devices'
import { follow, useHwLive } from '../hwsync'
import { useStore } from '../store'

const DEFAULTS = {
  onClose: 'stop' as 'continue' | 'stop' | 'shutdown',
  keepUsb: true,
  usbLimit: 0.5,
  led: 60,
  audio: false,
  sysFreq: 100e6,
  refClock: 'Internal',
  refFreq: 10e6,
  drive: '8 mA',
  slew: 'Fast' as 'Fast' | 'Slow' | 'Quiet',
  pull: 'None',
  threshold: 1.5,
  level: '3.3 V' as '3.3 V' | '1.8 V' | '2.5 V',
  trig: [
    { p: 'Trigger 1', m: 'Input', s: '—' },
    { p: 'Trigger 2', m: 'Output', s: 'Scope Trigger' }
  ]
}
type Opts = typeof DEFAULTS
const useOpts = create<Opts & { set: (p: Partial<Opts>) => void }>()(
  persist((set) => ({ ...DEFAULTS, set: (p) => set(p) }), {
    name: 'oscillo.device-options',
    version: 2,
    migrate: (x) => {
      const o = { ...DEFAULTS, ...(x as Partial<Opts>) }
      if (!['Fast', 'Slow', 'Quiet'].includes(o.slew)) o.slew = 'Fast'
      if (!['None', 'Pull Up', 'Pull Down'].includes(o.pull)) o.pull = 'None'
      return o
    },
    partialize: ({ set: _s, ...r }) => r
  })
)

/** What the open device took from the last push. */
const useApplied = create<OptionsReply | null>()(() => null)

const toRequest = (o: Opts): OptionsRequest => ({
  onClose: o.onClose === 'continue' ? 0 : o.onClose === 'stop' ? 1 : 2,
  keepUsb: o.keepUsb,
  usbLimit: o.usbLimit,
  led: o.led,
  audio: o.audio,
  sysFreq: o.sysFreq,
  clockMode: o.refClock === 'Internal' ? 0 : o.refClock === 'External In' ? 2 : 1,
  refFreq: o.refFreq,
  digitalVolts: parseFloat(o.level),
  threshold: o.threshold,
  driveMa: parseFloat(o.drive),
  slew: o.slew === 'Fast' ? 2 : o.slew === 'Slow' ? 1 : 0,
  pull: o.pull === 'Pull Up' ? 'Up' : o.pull === 'Pull Down' ? 'Down' : 'None',
  // TRIGSRC 4 is the scope's trigger; 0 leaves the pin as an input.
  triggers: o.trig.map((t) => (t.m === 'Output' ? 4 : 0))
})

// Pushed whenever an option changes and after connecting, on real hardware.
follow(
  [useOpts],
  () => toRequest(useOpts.getState()),
  async (r) => {
    useApplied.setState(await hw!.options(r), true)
  },
  'device options'
)

const W = 'w-[280px] max-[1100px]:w-[240px]'

export function DeviceOptions() {
  const o = useOpts()
  const app = useStore()
  const dev = useDevice()
  const mon = useHwLive((h) => h.monitor)
  const real = useHardware()
  const applied = useApplied()
  const fmt = (v: number | undefined, f: (x: number) => string) => (v === undefined || !Number.isFinite(v) ? 'Not reported' : f(v))

  const readings = app.device
    ? [
        { k: 'USB Voltage', v: fmt(mon?.usb.volts, (x) => x.toFixed(2) + ' V') },
        { k: 'USB Current', v: fmt(mon?.usb.amps, (x) => Math.round(x * 1000) + ' mA') },
        { k: 'Temperature', v: fmt(mon?.temperature, (x) => x.toFixed(1) + ' °C') }
      ]
    : [{ k: 'Device', v: 'Not connected' }]

  return (
    <ScrollPage
      className="flex flex-col gap-4"
      bar={
        <PageBar title="Device Options" sub={dev?.name ?? 'No device connected'}>
          <Button size="small" type="tertiary" prefix={<RefreshCw size={16} />} onClick={() => { o.set(DEFAULTS); app.toast('Defaults restored') }}>
            Restore Defaults
          </Button>
        </PageBar>
      }
    >
      {app.device && !real && (
        <Note size="small">The Demo Device has none of these options. They are kept and applied when you connect real hardware.</Note>
      )}
      {real && applied && applied.unsupported.length > 0 && (
        <Note size="small">
          {dev?.name} does not have {applied.unsupported.join(', ')}. Those settings are kept but have no effect on it.
        </Note>
      )}
      <Fieldset title="Power and Behavior" subtitle="What the device does with power, LEDs and outputs." titleSize={16} bodyClassName="gap-0">
        <OptionRow label="On Close" description="What the device does when Oscillo closes.">
          <Switch aria-label="On Close" value={o.onClose} options={[{ label: 'Keep Running', value: 'continue' }, { label: 'Stop Outputs', value: 'stop' }, { label: 'Shut Down', value: 'shutdown' }] as const} onChange={(onClose) => o.set({ onClose })} />
        </OptionRow>
        <OptionRow label="Keep USB Power On with AUX Supply" description="Stay powered from USB when an auxiliary supply is connected.">
          <Toggle checked={o.keepUsb} aria-label="Keep USB Power On with AUX Supply" onChange={(keepUsb) => o.set({ keepUsb })} />
        </OptionRow>
        <OptionRow label="USB Current Limit" description="Maximum current drawn from the USB port.">
          <div className={W}>
            <UnitInput label="USB Current Limit" hideLabel value={o.usbLimit} scale={1e-3} suffix="mA" decimals={0} min={0.1} max={0.9} onCommit={(usbLimit) => o.set({ usbLimit })} />
          </div>
        </OptionRow>
        <OptionRow label="LED Brightness" description="Brightness of the status LED on the device.">
          <div className={W}>
            <Slider aria-label="LED Brightness" value={o.led} min={0} max={100} valueLabel={`${o.led}%`} onChange={(led) => o.set({ led })} />
          </div>
        </OptionRow>
        <OptionRow label="Audio Output" description="Send Wavegen channel 1 to the audio jack.">
          <Toggle checked={o.audio} aria-label="Audio Output" onChange={(audio) => o.set({ audio })} />
        </OptionRow>
      </Fieldset>

      <Fieldset title="Clocking" subtitle="The clock every instrument samples from." titleSize={16} bodyClassName="gap-0">
        <OptionRow label="System Frequency" description="Base clock for acquisition and generation.">
          <div className={W}>
            <UnitInput label="System Frequency" hideLabel value={o.sysFreq} scale={1e6} suffix="MHz" min={50e6} max={125e6} onCommit={(sysFreq) => o.set({ sysFreq })} />
          </div>
        </OptionRow>
        <OptionRow label="Reference Clock" description="Lock to the internal oscillator or an external reference.">
          <div className={W}>
            <Select size="small" aria-label="Reference Clock" value={o.refClock} options={['Internal', 'External In', 'Output on Trigger 2']} onValueChange={(refClock) => o.set({ refClock })} />
          </div>
        </OptionRow>
        <OptionRow label="Reference Frequency" description="Frequency of the external reference.">
          <div className={W}>
            <UnitInput label="Reference Frequency" hideLabel value={o.refFreq} scale={1e6} suffix="MHz" min={1e6} max={100e6} disabled={o.refClock === 'Internal'} onCommit={(refFreq) => o.set({ refFreq })} />
          </div>
        </OptionRow>
      </Fieldset>

      <Fieldset title="Digital I/O" subtitle="Electrical settings for DIO pins." titleSize={16} bodyClassName="gap-0">
        <OptionRow label="Drive Strength" description="Output current per pin.">
          <div className={W}>
            <Select size="small" aria-label="Drive Strength" value={o.drive} options={['4 mA', '8 mA', '12 mA', '16 mA']} onValueChange={(drive) => o.set({ drive })} />
          </div>
        </OptionRow>
        <OptionRow label="Slew" description="Edge rate of digital outputs.">
          <Switch aria-label="Slew" value={o.slew} options={['Fast', 'Slow', 'Quiet'] as const} onChange={(slew) => o.set({ slew })} />
        </OptionRow>
        <OptionRow label="Pull" description="Resistor applied to inputs that are not driven.">
          <div className={W}>
            <Select size="small" aria-label="Pull" value={o.pull} options={['None', 'Pull Up', 'Pull Down']} onValueChange={(pull) => o.set({ pull })} />
          </div>
        </OptionRow>
        <OptionRow label="Input Threshold" description="Voltage where an input reads high.">
          <div className={W}>
            <UnitInput label="Input Threshold" hideLabel value={o.threshold} suffix="V" min={0.5} max={3} onCommit={(threshold) => o.set({ threshold })} />
          </div>
        </OptionRow>
        <OptionRow label="Logic Level" description="Supply voltage for the DIO bank.">
          <Switch aria-label="Logic Level" value={o.level} options={['3.3 V', '1.8 V', '2.5 V'] as const} onChange={(level) => o.set({ level })} />
        </OptionRow>
      </Fieldset>

      <Fieldset
        title="Triggers"
        subtitle="External trigger pins and what drives them."
        titleSize={16}
        footer={`Trigger 2 ${o.trig[1].m === 'Output' ? 'outputs ' + o.trig[1].s : 'is an input'}.`}
        actions={
          <Button size="small" type="secondary" onClick={() => o.set({ trig: o.trig.map((t) => ({ ...t, m: t.m === 'Input' ? 'Output' : 'Input', s: t.m === 'Input' ? 'Scope Trigger' : '—' })) })}>
            Swap Directions
          </Button>
        }
      >
        <Table compact caption="Trigger pins" columns={[{ key: 'p', title: 'Pin' }, { key: 'm', title: 'Mode' }, { key: 's', title: 'Source' }]} rows={o.trig} />
      </Fieldset>

      <Fieldset title="System Monitor" subtitle="Live readings from the device, twice a second." titleSize={16}>
        <Table compact caption="System monitor" columns={[{ key: 'k', title: 'Reading' }, { key: 'v', title: 'Value', align: 'right' }]} rows={readings} />
      </Fieldset>
    </ScrollPage>
  )
}
