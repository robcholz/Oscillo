// Calibration (board: Calibration). A guided six-step calibration with measured gain and offset,
// factory restore, and calibration files.
import { Button, Description, Fieldset, FormModal, Note, StatusDot, type FormField } from '@robcholz/geist'
import { FolderOpen, RefreshCw, Save } from 'lucide-react'
import { useState } from 'react'
import { PageBar, ScrollPage } from '../components/Page'
import { useDevice } from '../devices'
import { useStore } from '../store'

const STEPS = [
  { t: 'Scope Offset', sub: 'Leave both scope inputs unconnected. The scope measures its own zero offset.', exp: 0, unit: 'mV', wait: 'Leave Inputs Open' },
  { t: 'Scope Gain, Channel 1', sub: 'Connect scope channel 1 to Wavegen 1. The wavegen outputs 4 V, then −4 V.', exp: 4, unit: 'V', wait: 'Connect C1 to Wavegen 1' },
  { t: 'Scope Gain, Channel 2', sub: 'Connect scope channel 2 to Wavegen 1. The wavegen outputs 4 V, then −4 V.', exp: 4, unit: 'V', wait: 'Connect C2 to Wavegen 1' },
  { t: 'Wavegen Offset and Gain', sub: 'Keep channel 1 connected to Wavegen 1 and connect channel 2 to Wavegen 2.', exp: 2, unit: 'V', wait: 'Connect C2 to Wavegen 2' },
  { t: 'Supplies', sub: 'Connect scope channel 1 to V+ and channel 2 to V−. Supplies are set to ±3 V.', exp: 3, unit: 'V', wait: 'Connect C1 to V+, C2 to V−' },
  { t: 'Voltmeter', sub: 'Connect both scope channels to ground. The voltmeter reference is measured.', exp: 0, unit: 'mV', wait: 'Connect C1 and C2 to Ground' }
]
const N = STEPS.length

interface Meas {
  val: number
  g: number
  o: number
}

let memo: { done: number; view: number; meas: Record<number, Meas>; last: string; source: string } | null = null

export function Calibration() {
  const app = useStore()
  const toast = app.toast
  const [st, setSt] = useState(memo ?? { done: 1, view: 1, meas: { 0: { val: 0.0012, g: 1, o: 1.2 } } as Record<number, Meas>, last: 'Sep 12, 2026', source: 'Factory' })
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void; description?: string }>(null)
  const update = (p: Partial<typeof st>) => setSt((x) => (memo = { ...x, ...p }))
  const dev = useDevice()

  const all = st.done >= N
  const v = Math.min(st.view, N - 1)
  const s = STEPS[v]
  const m = st.meas[v]
  const isCur = st.view === st.done
  const viewDone = v < st.done && st.view < N
  const fmtV = (x: number) => (s.unit === 'mV' ? (x * 1000).toFixed(1) + ' mV' : x.toFixed(3) + ' V')

  const next = () => {
    if (busy) return
    if (!app.device) return toast('No device connected', { detail: 'Connect the device you want to calibrate.' })
    if (all && isCur) {
      update({ last: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), source: 'Device Memory' })
      return toast('Calibration saved to the device')
    }
    if (!isCur && !viewDone) return update({ view: st.done })
    setBusy(true)
    setTimeout(() => {
      const g = 1 + (Math.random() - 0.5) * 0.008
      const o = (Math.random() - 0.5) * 3
      const meas = { ...st.meas, [v]: { val: s.exp / g + o / 1000, g, o } }
      setBusy(false)
      if (isCur) {
        update({ meas, done: st.done + 1, view: st.done + 1 })
        toast(`${s.t} calibrated`)
      } else {
        update({ meas })
        toast(`${s.t} measured again`)
      }
    }, 700)
  }

  const cur =
    all && isCur
      ? { title: 'Calibration Complete', sub: 'Every instrument was measured and corrected.', footer: `${N} of ${N} steps done`, action: 'Save to Device', gain: '—', off: '—' }
      : {
          title: s.t,
          sub: s.sub,
          footer: m ? `Measured: ${fmtV(m.val)} · Expected: ${fmtV(s.exp)}` : `Expected: ${fmtV(s.exp)}`,
          action: busy ? 'Measuring…' : viewDone ? 'Measure Again' : isCur ? 'Measure and Continue' : 'Go to Current Step',
          gain: m ? m.g.toFixed(4) : '—',
          off: m ? m.o.toFixed(1) + ' mV' : '—'
        }

  return (
    <ScrollPage
      className="flex max-w-[1120px] flex-col gap-4"
      bar={
        <PageBar title="Calibration" status={<StatusDot state={all ? 'READY' : 'BUILDING'} label={all ? 'Calibrated' : `Step ${st.done + 1} of ${N}`} />} sub={dev?.name ?? 'No Device'}>
          <Button size="small" type="secondary" prefix={<RefreshCw size={16} />} onClick={() => setDialog({ title: 'Load Factory Calibration', description: 'This replaces the current calibration with the values stored at the factory.', fields: [], submitLabel: 'Load Factory', onSubmit: () => { update({ done: N, view: N, meas: {}, source: 'Factory' }); toast('Factory calibration loaded') } })}>
            Load Factory
          </Button>
          <Button size="small" type="tertiary" prefix={<FolderOpen size={16} />} onClick={() => setDialog({ title: 'Open Calibration File', fields: [{ key: 'f', label: 'File', value: 'AD3_calibration.dcal', required: true, mono: true }], submitLabel: 'Open', onSubmit: (x) => { update({ done: N, view: N, source: x.f }); toast(`Loaded ${x.f}`) } })}>
            Open File
          </Button>
          <Button size="small" type="tertiary" prefix={<Save size={16} />} onClick={() => setDialog({ title: 'Save Calibration File', fields: [{ key: 'f', label: 'File Name', value: 'AD3_calibration.dcal', required: true, mono: true }], submitLabel: 'Save', onSubmit: (x) => toast(`Saved ${x.f}`) })}>
            Save File
          </Button>
        </PageBar>
      }
    >
      <Fieldset
        title={cur.title}
        subtitle={cur.sub}
        titleSize={16}
        footer={cur.footer}
        actions={
          <Button size="small" disabled={busy} onClick={next}>
            {cur.action}
          </Button>
        }
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <Description title="Gain Correction" content={<span className="tabular-nums">{cur.gain}</span>} />
          <Description title="Offset Correction" content={<span className="tabular-nums">{cur.off}</span>} />
          <Description title="Last Calibrated" content={st.last} />
          <Description title="Source" content={st.source} />
        </div>
        <Note type={all ? 'success' : 'warning'} size="small" className="mt-3">
          {all ? 'All steps passed. Save the calibration to the device to keep it after power off.' : 'Disconnect everything else from the device before calibrating.'}
        </Note>
      </Fieldset>
      <Fieldset title="All Steps" subtitle={`${all ? `All ${N} steps done` : `${st.done} of ${N} done`}. Pick a step to redo it.`} titleSize={16} bodyClassName="gap-3">
        <div className="-mx-6 -mb-6 shadow-[inset_0_1px_0_var(--gray-alpha-400)]">
          {STEPS.map((x, i) => {
            const state = i < st.done ? 'READY' : i === st.done ? 'BUILDING' : 'QUEUED'
            return (
              <button
                key={i}
                type="button"
                aria-current={i === v ? 'step' : undefined}
                onClick={() => update({ view: i })}
                className={`flex min-h-11 w-full items-center gap-3 px-6 text-left shadow-[inset_0_-1px_0_var(--gray-alpha-400)] last:shadow-none hover:bg-gray-alpha-100 ${i === v ? 'bg-gray-alpha-100' : ''}`}
              >
                <StatusDot state={state} />
                <span className="flex-1 text-sm">{x.t}</span>
                <span className="text-[13px] text-gray-900">{i < st.done ? 'Done' : i === st.done ? (busy ? 'Measuring…' : x.wait) : 'Waiting'}</span>
              </button>
            )
          })}
        </div>
      </Fieldset>
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </ScrollPage>
  )
}
