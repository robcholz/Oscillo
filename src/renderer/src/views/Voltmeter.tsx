// Voltmeter (board: Voltmeter). DC, AC RMS and true RMS for each scope channel.
import { Button, Material, Note, Select, StatusDot } from '@robcholz/geist'
import { Pause, Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PageBar, ScrollPage } from '../components/Page'
import { fixed } from '../components/format'
import { useInterval } from '../components/useInterval'
import { wantMeters } from '../hwsync'
import { useStore } from '../store'
import { readChannel, type Reading } from './meters'

const RANGES = ['Auto', '±2.5 V', '±25 V']

interface VM {
  running: boolean
  range: [string, string]
  set: (p: Partial<Omit<VM, 'set'>>) => void
}
export const useVoltmeter = create<VM>()(
  persist((set) => ({ running: true, range: ['Auto', 'Auto'], set: (p) => set(p) }), { name: 'oscillo.voltmeter', partialize: ({ set: _s, ...r }) => r })
)

const ZERO: Reading = { dc: 0, ac: 0, rms: 0 }

function clip(r: Reading, range: string): Reading & { over: boolean } {
  const lim = range === '±2.5 V' ? 2.5 : 25
  const over = Math.abs(r.dc) + r.ac * 1.414 > lim
  return { ...r, over }
}

export function Voltmeter() {
  const vm = useVoltmeter()
  const app = useStore()
  const [hold, setHold] = useState(false)
  const [r, setR] = useState<[Reading, Reading]>([ZERO, ZERO])
  const live = vm.running && app.running && !!app.device && !hold
  useEffect(() => wantMeters(live), [live])
  useInterval(() => setR([readChannel(0), readChannel(1)]), 400, live)

  const run = () => {
    if (!app.device) return app.toast('No device connected', { detail: 'Connect a device, then press Run.' })
    if (!app.running) app.setRunning(true)
    vm.set({ running: !vm.running })
    app.toast(vm.running ? 'Voltmeter stopped' : 'Voltmeter running', { detail: vm.running ? undefined : 'Scope, Logger and Spectrum were stopped.' })
  }

  return (
    <ScrollPage
      className="flex flex-col gap-4"
      bar={
        <PageBar
          title="Voltmeter"
          status={<StatusDot state={live ? 'READY' : hold ? 'BUILDING' : 'QUEUED'} label={live ? 'Running' : hold ? 'Held' : 'Stopped'} />}
          sub="Uses the oscilloscope channels"
        >
          <Button size="small" type="secondary" prefix={hold ? <Play size={16} /> : <Pause size={16} />} aria-pressed={hold} onClick={() => setHold(!hold)} tooltip={hold ? 'Resume live readings' : 'Freeze the readings'}>
            {hold ? 'Resume' : 'Hold'}
          </Button>
          <Button size="small" prefix={vm.running && app.running ? <Square size={16} /> : <Play size={16} />} onClick={run} tooltipKeys={['Space']}>
            {vm.running && app.running ? 'Stop' : 'Run'}
          </Button>
        </PageBar>
      }
    >
      {([0, 1] as const).map((i) => {
        const x = clip(r[i], vm.range[i])
        return (
          <Material key={i} className="flex min-w-0 flex-col gap-4 p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 flex items-center gap-2 text-base font-semibold leading-6 tracking-[-0.32px]">
                <span className="h-0.5 w-3 rounded-full" style={{ background: i ? 'var(--wf-c2)' : 'var(--wf-c1)' }} aria-hidden />
                Channel {i + 1}
              </h2>
              <div className="w-[120px] flex-none">
                <Select size="small" aria-label={`Channel ${i + 1} range`} value={vm.range[i]} options={RANGES} onValueChange={(v) => vm.set({ range: (i ? [vm.range[0], v] : [v, vm.range[1]]) as [string, string] })} />
              </div>
            </div>
            {/* DC large, then AC RMS and True RMS on the same row, as on a bench meter. */}
            <div className="grid grid-cols-3 items-end gap-6">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[13px] leading-4 text-gray-900">DC</span>
                <span className={`truncate text-5xl font-semibold tabular-nums tracking-[-2.88px] ${x.over ? 'text-red-900' : ''}`}>{x.over ? 'Over Range' : fixed(x.dc, 'V', 3)}</span>
              </div>
              {(
                [
                  ['AC RMS', x.ac],
                  ['True RMS', x.rms]
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex min-w-0 flex-col gap-1 pb-1">
                  <span className="text-[13px] leading-4 text-gray-900">{k}</span>
                  <span className="truncate text-[32px] font-semibold leading-10 tabular-nums tracking-[-1.28px]">{fixed(v, 'V', 3)}</span>
                </div>
              ))}
            </div>
          </Material>
        )
      })}
      <Note type="secondary" size="small">
        Starting the Voltmeter stops Scope, Logger and Spectrum, which share the same channels.
      </Note>
    </ScrollPage>
  )
}
