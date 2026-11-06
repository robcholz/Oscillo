// Power Supplies (board: Supplies). Master enable, ±5 V rails with current limits, live readback and
// the USB power budget.
import { Description, Gauge, Material, Note, Progress, StatusDot, Toggle } from '@robcholz/geist'
import { useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PageBar, ScrollPage } from '../components/Page'
import { UnitInput } from '../components/UnitInput'
import { fixed } from '../components/format'
import { jitter, useInterval } from '../components/useInterval'
import { follow, isHardware, pushSupplies, useHwLive } from '../hwsync'
import { useStore } from '../store'

interface Rail {
  on: boolean
  volts: number
  limit: number
}
interface SupplyState {
  master: boolean
  pos: Rail
  neg: Rail
  set: (p: Partial<Omit<SupplyState, 'set'>>) => void
}

export const useSupplies = create<SupplyState>()(
  persist(
    (set) => ({
      master: false,
      pos: { on: true, volts: 5, limit: 0.7 },
      neg: { on: false, volts: -5, limit: 0.7 },
      set: (p) => set(p)
    }),
    { name: 'oscillo.supplies', partialize: ({ set: _s, ...rest }) => rest }
  )
)

/** Simulated load: 47 Ω on each rail, limited by the current limit. */
const LOAD = 47
const USB_LIMIT = 2.5
const IDLE_W = 0.62

// Real hardware follows the switches and setpoints.
follow([useSupplies], () => { const { master, pos, neg } = useSupplies.getState(); return { master, pos, neg } }, pushSupplies, 'the supplies')

/** What a rail measures: from the device's monitor on real hardware, else the simulated load. */
function reading(r: Rail, live: boolean, side: 'pos' | 'neg') {
  if (!live || !r.on) return { v: 0, i: 0, limited: false }
  const mon = isHardware() ? useHwLive.getState().monitor : null
  if (mon) {
    const m = mon[side]
    const v = Number.isFinite(m.volts) ? m.volts : 0
    const i = Number.isFinite(m.amps) ? Math.abs(m.amps) : 0
    return { v, i, limited: i >= r.limit * 0.98 }
  }
  const want = Math.abs(r.volts) / LOAD
  const limited = want > r.limit
  const i = Math.min(want, r.limit)
  const v = limited ? Math.sign(r.volts) * i * LOAD : r.volts
  return { v: v + jitter(0.002), i: i + jitter(0.0004), limited }
}

function RailCard({ name, rail, live, sign, onChange }: { name: string; rail: Rail; live: boolean; sign: 1 | -1; onChange: (r: Partial<Rail>) => void }) {
  const [, tick] = useState(0)
  useInterval(() => tick((n) => n + 1), 500, live && rail.on)
  const m = reading(rail, live, sign > 0 ? 'pos' : 'neg')
  const watts = Math.abs(m.v * m.i)
  const state = !rail.on ? 'CANCELED' : m.limited ? 'ERROR' : live ? 'READY' : 'QUEUED'
  const label = !rail.on ? 'Off' : m.limited ? 'Current Limited' : live ? 'On' : 'Ready'
  return (
    <Material className="flex min-w-0 flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">{name}</h2>
          <StatusDot state={state} label={label} />
        </div>
        <Toggle checked={rail.on} onChange={(on) => onChange({ on })}>
          Enabled
        </Toggle>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <UnitInput label="Voltage" value={rail.volts} suffix="V" decimals={3} min={sign > 0 ? 0.5 : -5} max={sign > 0 ? 5 : -0.5} onCommit={(volts) => onChange({ volts })} />
        <UnitInput label="Current Limit" value={rail.limit} scale={1e-3} suffix="mA" decimals={0} min={0.01} max={0.7} onCommit={(limit) => onChange({ limit })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Description title="Measured Voltage" content={<span className="text-2xl font-semibold tabular-nums tracking-[-0.96px]">{fixed(m.v, 'V', 3)}</span>} />
        <Description title="Measured Current" content={<span className="text-2xl font-semibold tabular-nums tracking-[-0.96px]">{fixed(m.i * 1000, 'mA', 1)}</span>} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-[13px] leading-4 text-gray-900">
          <span>Power</span>
          <span className="tabular-nums">{fixed(watts, 'W', 2)} of {fixed(Math.abs(rail.volts) * rail.limit, 'W', 2)}</span>
        </div>
        <Progress value={watts} max={Math.max(0.01, Math.abs(rail.volts) * rail.limit)} colors={{ 0: 'var(--gray-1000)', 80: 'var(--amber-700)', 95: 'var(--red-800)' }} aria-label={`${name} power`} />
      </div>
    </Material>
  )
}

export function Supplies() {
  const s = useSupplies()
  const app = useStore()
  const live = s.master && !!app.device
  const [, tick] = useState(0)
  useInterval(() => tick((n) => n + 1), 1000, live)
  const p = reading(s.pos, live, 'pos')
  const n = reading(s.neg, live, 'neg')
  const usb = useHwLive((h) => h.monitor?.usb)
  const measured = isHardware() && !!usb && Number.isFinite(usb.volts) && Number.isFinite(usb.amps)
  const total = measured ? usb.volts * usb.amps : IDLE_W + Math.abs(p.v * p.i) + Math.abs(n.v * n.i)
  const pct = Math.min(100, Math.round((total / USB_LIMIT) * 100))

  const setMaster = (master: boolean) => {
    if (master && !app.device) {
      app.toast('No device connected', { detail: 'Connect a device, then turn on Master Enable.' })
      return
    }
    s.set({ master })
    app.toast(master ? 'Supplies on' : 'Supplies off')
  }

  return (
    <ScrollPage
      className="flex flex-col gap-4"
      bar={
        <PageBar title="Power Supplies" status={<StatusDot state={live ? 'READY' : 'QUEUED'} label={live ? 'Enabled' : 'Disabled'} />}>
          <Toggle checked={s.master} onChange={setMaster}>
            Master Enable
          </Toggle>
        </PageBar>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
        <RailCard name="Positive Supply" sign={1} rail={s.pos} live={live} onChange={(r) => s.set({ pos: { ...s.pos, ...r } })} />
        <RailCard name="Negative Supply" sign={-1} rail={s.neg} live={live} onChange={(r) => s.set({ neg: { ...s.neg, ...r } })} />
        <Material className="flex min-w-0 flex-col gap-4 p-6">
          <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.32px]">USB Power</h2>
          <div className="flex items-center gap-6">
            <Gauge value={pct} label="USB power used" size="large" showValue colors={{ 0: 'var(--gray-1000)', 80: 'var(--amber-700)', 95: 'var(--red-800)' }} />
            <div className="flex flex-col gap-3">
              <Description title="Total" content={<span className="tabular-nums">{fixed(total, 'W', 2)}</span>} />
              <Description title="USB Limit" content={fixed(USB_LIMIT, 'W', 2)} />
              <Description title="Source" content="USB, AUX Not Connected" />
            </div>
          </div>
        </Material>
      </div>
      <Note type="secondary" size="small">
        Rails show Ready until Master Enable is on. Agents can change these settings only after you approve the request.
      </Note>
    </ScrollPage>
  )
}
