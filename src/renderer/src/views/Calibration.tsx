// Calibration (board: Calibration). A guided six-step calibration that measures gain and offset
// corrections on the connected device, saved per device on this computer and applied to every
// capture, wavegen output and supply setting. The device's own factory calibration always applies.
import { Button, Description, Fieldset, FormModal, Note, StatusDot, type FormField } from '@robcholz/geist'
import { FolderOpen, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CalStatus, StepResult } from '../../../shared/calibration'
import { PageBar, ScrollPage } from '../components/Page'
import { UnitInput } from '../components/UnitInput'
import { useDevice } from '../devices'
import { files, saveText } from '../files'
import { resync } from '../hwsync'
import { useStore } from '../store'

const cal = typeof window !== 'undefined' ? (window.oscillo?.calibration ?? null) : null

const STEPS = [
  { t: 'Scope Offset', sub: 'Leave both scope inputs unconnected. The scope measures its own zero offset.', exp: 0, unit: 'mV', wait: 'Leave Inputs Open', ref: false },
  { t: 'Scope Gain, Channel 1', sub: 'Connect scope channel 1 to Wavegen 1. The wavegen outputs the reference voltage, then its negative.', exp: 4, unit: 'V', wait: 'Connect C1 to Wavegen 1', ref: true },
  { t: 'Scope Gain, Channel 2', sub: 'Connect scope channel 2 to Wavegen 1. The wavegen outputs the reference voltage, then its negative.', exp: 4, unit: 'V', wait: 'Connect C2 to Wavegen 1', ref: true },
  { t: 'Wavegen Offset and Gain', sub: 'Connect channel 1 to Wavegen 1 and channel 2 to Wavegen 2. Both output ±2 V.', exp: 2, unit: 'V', wait: 'Connect C1 to W1, C2 to W2', ref: false },
  { t: 'Supplies', sub: 'Connect scope channel 1 to V+ and channel 2 to V−. The supplies step through ±1 V and ±3 V.', exp: 3, unit: 'V', wait: 'Connect C1 to V+, C2 to V−', ref: false },
  { t: 'Voltmeter', sub: 'Connect both scope channels to ground. What remains is removed from every reading.', exp: 0, unit: 'mV', wait: 'Connect C1 and C2 to Ground', ref: false }
]
const N = STEPS.length

let memo: { done: number; view: number; meas: Record<number, StepResult>; serial: string | null } | null = null
const plain = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function Calibration() {
  const app = useStore()
  const toast = app.toast
  const dev = useDevice()
  const [st, setSt] = useState(memo && memo.serial === (dev?.serial ?? null) ? memo : { done: 0, view: 0, meas: {} as Record<number, StepResult>, serial: dev?.serial ?? null })
  const [status, setStatus] = useState<CalStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [ref, setRef] = useState(4)
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void; description?: string }>(null)
  const update = (p: Partial<typeof st>) => setSt((x) => (memo = { ...x, ...p }))

  useEffect(() => {
    if (!app.device) return setStatus(null)
    void cal?.status().then(setStatus).catch(() => setStatus(null))
  }, [app.device])

  const all = st.done >= N
  const v = Math.min(st.view, N - 1)
  const s = STEPS[v]
  const m = st.meas[v]
  const isCur = st.view === st.done
  const viewDone = v < st.done && st.view < N
  const fmtV = (x: number) => (s.unit === 'mV' ? (x * 1000).toFixed(1) + ' mV' : x.toFixed(3) + ' V')
  const active = status?.active
  const when = active ? new Date(active.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'

  const after = (x: CalStatus, title: string, detail?: string) => {
    setStatus(x)
    resync()
    toast(title, { detail })
  }

  const next = async () => {
    if (busy || !cal) return
    if (!app.device) return toast('No device connected', { detail: 'Connect the device you want to calibrate.' })
    if (all && isCur) {
      try {
        after(await cal.save(), 'Calibration saved', `Applied to ${dev?.name ?? 'the device'} from now on, on this computer.`)
        update({ done: 0, view: 0, meas: {} })
      } catch (e) {
        toast('Could not save', { detail: plain(e) })
      }
      return
    }
    if (!isCur && !viewDone) return update({ view: st.done })
    setBusy(true)
    try {
      if (st.done === 0 && isCur) await cal.begin()
      const r = await cal.step(v, s.ref ? ref : undefined)
      const meas = { ...st.meas, [v]: r }
      if (isCur) update({ meas, done: st.done + 1, view: st.done + 1 })
      else update({ meas })
      toast(isCur ? `${s.t} calibrated` : `${s.t} measured again`, { detail: r.detail })
    } catch (e) {
      toast(`${s.t} failed`, { detail: plain(e) })
    } finally {
      setBusy(false)
      resync()
    }
  }

  const cur =
    all && isCur
      ? { title: 'Calibration Complete', sub: 'Every step was measured. Save to apply the corrections.', footer: `${N} of ${N} steps done`, action: 'Save Calibration', gain: '—', off: '—' }
      : {
          title: s.t,
          sub: s.sub,
          footer: m ? `Measured: ${fmtV(m.value)} · Expected: ${fmtV(s.ref ? ref : s.exp)}` : `Expected: ${fmtV(s.ref ? ref : s.exp)}`,
          action: busy ? 'Measuring…' : viewDone ? 'Measure Again' : isCur ? 'Measure and Continue' : 'Go to Current Step',
          gain: m ? m.corr.gain.toFixed(4) : '—',
          off: m ? (m.corr.offset * 1000).toFixed(1) + ' mV' : '—'
        }

  const openFile = async () => {
    if (!files || !cal) return
    const f = await files.open([{ name: 'Oscillo Calibration', extensions: ['json', 'oscal'] }])
    if (!f) return
    try {
      after(await cal.load(JSON.parse(f.text)), `Loaded ${f.name}`, `Saved and applied to ${dev?.name ?? 'the device'}.`)
    } catch (e) {
      toast('Could not load the calibration', { detail: plain(e) })
    }
  }

  return (
    <ScrollPage
      className="flex flex-col gap-4"
      bar={
        <PageBar title="Calibration" status={<StatusDot state={all ? 'READY' : st.done ? 'BUILDING' : active ? 'READY' : 'QUEUED'} label={all ? 'Ready to Save' : st.done ? `Step ${st.done + 1} of ${N}` : active ? 'Corrected' : 'Factory'} />} sub={dev?.name ?? 'No Device'}>
          <Button
            size="small"
            type="secondary"
            prefix={<RefreshCw size={16} />}
            disabled={!app.device || !active}
            onClick={() =>
              setDialog({
                title: 'Use Factory Calibration',
                description: `This removes the corrections saved for ${dev?.name ?? 'this device'}. The calibration stored in the device at the factory stays in use.`,
                fields: [],
                submitLabel: 'Remove Corrections',
                onSubmit: async () => {
                  if (!cal) return
                  after(await cal.clear(), 'Factory calibration in use')
                  update({ done: 0, view: 0, meas: {} })
                }
              })
            }
          >
            Use Factory
          </Button>
          <Button size="small" type="tertiary" prefix={<FolderOpen size={16} />} disabled={!app.device} onClick={() => void openFile()}>
            Open File
          </Button>
          <Button size="small" type="tertiary" prefix={<Save size={16} />} disabled={!active} onClick={() => active && void saveText(`${active.device.replace(/\s+/g, '_')}_calibration.json`, JSON.stringify(active, null, 1), [{ name: 'Oscillo Calibration', extensions: ['json'] }])}>
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
          <Button size="small" loading={busy} onClick={() => void next()}>
            {cur.action}
          </Button>
        }
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <Description title="Gain Correction" content={<span className="tabular-nums">{cur.gain}</span>} />
          <Description title="Offset Correction" content={<span className="tabular-nums">{cur.off}</span>} />
          <Description title="Last Calibrated" content={when} />
          <Description title="Source" content={active ? 'Saved Corrections' : 'Factory'} />
        </div>
        {s.ref && !(all && isCur) && (
          <div className="mt-3 w-[220px]">
            <UnitInput label="Reference Voltage" value={ref} suffix="V" min={1} max={5} onCommit={setRef} />
            <p className="m-0 mt-1 text-[13px] leading-4 text-gray-900">Measure Wavegen 1 with a trusted meter and enter what it reads for the best accuracy.</p>
          </div>
        )}
        <Note type={all ? 'success' : 'warning'} size="small" className="mt-3">
          {all ? 'All steps passed. Save to apply the corrections to every capture and output.' : 'Disconnect everything else from the device before calibrating. Outputs switch on during steps.'}
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
