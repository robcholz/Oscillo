// Script (board: Script). Files on the left, the editor with breakpoints and the Console, Problems and
// Variables panel in the middle, run options on the right.
import { Badge, Button, FormModal, Note, Select, Snippet, StatusDot, Table, Tabs, Toggle, cn, type StatusDotState } from '@robcholz/geist'
import { Check, ChevronRight, CircleX, FileCode, FileText, Pencil, Play, Plus, Square, StepForward, Trash2, WandSparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CodeEditor, highlight } from '../components/Code'
import { Grid2, PageBar, PanelSection, SplitPage } from '../components/Page'
import { LIB, TEMPLATES, TYPES, hasProblem, useScript, type BottomTab } from './script-store'

function Folder({ name, files, cur, onOpen, initial = true }: { name: string; files: string[]; cur: string; onOpen: (f: string) => void; initial?: boolean }) {
  const [open, setOpen] = useState(initial || files.includes(cur))
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-small px-2 text-sm text-gray-1000 hover:bg-gray-alpha-100">
        <ChevronRight size={14} className={cn('text-gray-900 transition-transform', open && 'rotate-90')} />
        {name}
      </button>
      {open && (
        <ul role="group" className="m-0 list-none p-0">
          {files.map((f) => {
            const Icon = f.endsWith('.d.ts') ? FileText : FileCode
            return (
              <li key={f}>
                <button
                  type="button"
                  aria-current={f === cur ? 'true' : undefined}
                  onClick={() => onOpen(f)}
                  className={cn('flex h-8 w-full cursor-pointer items-center gap-2 rounded-small pl-7 pr-2 text-left text-sm', f === cur ? 'bg-gray-alpha-200 text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000')}
                >
                  <Icon size={16} className="flex-none" />
                  <span className="truncate font-mono text-[13px]">{f}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

export function Script() {
  const s = useScript()
  const [newOpen, setNewOpen] = useState(false)
  const code = s.files[s.cur] ?? ''
  const lines = code.split('\n')
  const bps = s.bps[s.cur] ?? []
  const prob = hasProblem(code)
  const r = s.run
  const paused = r.status === 'paused'
  const here = paused && r.file === s.cur ? r.line : 0
  const failedHere = r.status === 'failed' && r.file === s.cur
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [s.cons.length, s.btab])

  const [dot, label]: [StatusDotState, string] =
    r.status === 'paused' ? ['BUILDING', `Paused at Line ${r.line}`] : r.status === 'done' ? ['READY', 'Finished'] : r.status === 'stopped' ? ['CANCELED', 'Stopped'] : r.status === 'failed' ? ['ERROR', 'Failed at Line 10'] : ['QUEUED', 'Ready']
  const scripts = Object.keys(s.files).filter((f) => !LIB.includes(f) && !TYPES.includes(f))
  const sweepVars = r.file === 'frequency-sweep.ts' && r.status !== 'stopped' && r.status !== 'idle'
  const vars = sweepVars
    ? [
        { n: 'f', v: String(r.f), t: 'number' },
        { n: 'capture', v: r.line >= 10 || r.status === 'done' ? 'Capture { 8192 samples }' : 'undefined', t: 'Capture' },
        { n: 'vpp', v: r.vpp ?? 'undefined', t: 'number' },
        { n: 'log', v: 'File("sweep.csv")', t: 'File' }
      ]
    : []

  const bar = (
    <PageBar title="Script" status={<StatusDot state={dot} label={label} />}>
      <Badge variant="blue-subtle" size="sm">
        TypeScript
      </Badge>
      <Button type="secondary" size="small" svgOnly aria-label={paused ? 'Continue' : `Run ${s.cur}`} tooltip tooltipKeys={paused ? undefined : ['⌘', 'R']} tooltipPosition="bottom" onClick={s.runOrContinue}>
        <Play size={16} />
      </Button>
      <Button type="secondary" size="small" svgOnly aria-label="Step Over" tooltip tooltipPosition="bottom" disabled={!paused} onClick={s.step}>
        <StepForward size={16} />
      </Button>
      <Button type="secondary" size="small" prefix={<Square size={16} />} disabled={!paused} onClick={s.stop}>
        Stop
      </Button>
      <Button type="error" size="small" prefix={<X size={16} />} disabled={!paused} onClick={s.abort}>
        Abort
      </Button>
    </PageBar>
  )

  const files = (
    <aside aria-label="Files" className="flex w-[232px] flex-none flex-col gap-2 p-3 shadow-[inset_-1px_0_0_var(--gray-alpha-400)]">
      <div className="flex items-center justify-between">
        <h2 className="m-0 px-2 text-sm font-semibold leading-5 tracking-[-0.28px]">Files</h2>
        <Button type="tertiary" size="small" svgOnly aria-label="New Script" tooltip onClick={() => setNewOpen(true)}>
          <Plus size={16} />
        </Button>
      </div>
      <ul aria-label="Scripts" className="m-0 flex list-none flex-col p-0">
        <Folder name="scripts" files={scripts} cur={s.cur} onOpen={s.openFile} />
        <Folder name="lib" files={LIB} cur={s.cur} onOpen={s.openFile} initial={false} />
        <Folder name="types" files={TYPES} cur={s.cur} onOpen={s.openFile} initial={false} />
      </ul>
      <div className="mt-auto">
        <Note type="secondary" size="small">
          Scripts are saved with the workspace.
        </Note>
      </div>
    </aside>
  )

  const panel = (
    <>
      <PanelSection title="Run">
        <Toggle checked={s.tc} onChange={(tc) => s.set({ tc })} layout="row">
          Type-Check Before Run
        </Toggle>
        <Grid2>
          {(
            [
              ['Timeout', 'timeout', ['30 s', '5 min', 'None']],
              ['Sandbox', 'sandbox', ['Isolated', 'Allow Files', 'Allow Network']],
              ['Modules', 'modules', ['Built-in Only', 'Allow npm Imports']],
              ['Compatibility', 'compat', ['Oscillo API', 'WaveForms JS API']]
            ] as const
          ).map(([l, k, o]) => (
            <div key={k} className="flex min-w-0 flex-col gap-2">
              <span className="text-[13px] leading-4 text-gray-900">{l}</span>
              <Select size="small" aria-label={l} value={s[k]} options={o} onValueChange={(v) => s.set({ [k]: v })} />
            </div>
          ))}
        </Grid2>
      </PanelSection>
      <PanelSection title="Run from Terminal" className="shadow-none">
        <p className="m-0 text-[13px] leading-[18px] text-gray-900">Runs the open script without the app, with the options above.</p>
        <Snippet text={`oscillo --script ${s.cur}${s.sandbox === 'Isolated' ? '' : s.sandbox === 'Allow Files' ? ' --allow-files' : ' --allow-net'}${s.timeout === '30 s' ? '' : s.timeout === 'None' ? ' --timeout 0' : ' --timeout 300'}`} />
      </PanelSection>
    </>
  )

  const tabs = [
    { title: 'Console', value: 'c' },
    { title: prob ? 'Problems (1)' : 'Problems', value: 'p' },
    { title: 'Variables', value: 'v' }
  ]

  return (
    <SplitPage bar={bar} panelId="script" panel={panel} left={files}>
      <div className="flex items-center gap-1 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]">
        <div className="min-w-0 flex-1 overflow-x-auto [&_[data-geist-tabs]]:shadow-none">
          <Tabs tabs={s.open.map((f) => ({ title: f, value: f }))} selected={s.cur} setSelected={(cur) => s.set({ cur, editing: false })} />
        </div>
        <Button type="tertiary" size="small" prefix={s.editing ? <Check size={16} /> : <Pencil size={16} />} disabled={TYPES.includes(s.cur)} onClick={() => s.set({ editing: !s.editing })}>
          {s.editing ? 'Done Editing' : 'Edit Code'}
        </Button>
        <Button type="tertiary" size="small" prefix={<X size={16} />} disabled={s.open.length < 2} onClick={s.closeTab}>
          Close Tab
        </Button>
      </div>

      <div className="flex min-h-[120px] flex-[1_1_auto]! flex-col">
        {s.editing ? (
          <CodeEditor label={s.cur} value={code} onChange={s.edit} className="flex-1" />
        ) : (
          <div role="region" aria-label="Code" className="min-h-0 flex-1 overflow-auto rounded-small py-3 shadow-[0_0_0_1px_var(--gray-alpha-400)]">
            {lines.map((t, i) => {
              const n = i + 1
              const bp = bps.includes(n)
              const err = prob && /PeakToPeek/.test(t)
              return (
                <div key={i} className={cn('grid grid-cols-[48px_minmax(0,1fr)] font-mono text-[13px] leading-5', n === here ? 'bg-amber-100' : failedHere && err && 'bg-red-100')} onDoubleClick={() => s.set({ editing: true })}>
                  <button
                    type="button"
                    aria-label={`${bp ? 'Remove breakpoint on' : 'Add breakpoint on'} line ${n}`}
                    aria-pressed={bp}
                    onClick={() => s.toggleBp(n)}
                    className="group flex cursor-pointer items-center justify-end gap-1.5 pr-3 text-gray-700 hover:text-gray-1000"
                  >
                    <span className={cn('size-2 rounded-full', bp ? 'bg-red-800' : 'bg-transparent group-hover:bg-red-alpha-400')} aria-hidden />
                    <span className="min-w-4 text-right tabular-nums">{n}</span>
                  </button>
                  <span className={cn('whitespace-pre pr-3', err && 'underline decoration-red-900 decoration-wavy underline-offset-[3px] [text-decoration-skip-ink:none]')}>{t ? highlight(t) : ' '}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div role="region" aria-label="Output" className="flex h-[clamp(168px,34%,280px)] min-h-0 flex-col overflow-hidden rounded-small shadow-[0_0_0_1px_var(--gray-alpha-400)]">
        <div className="flex flex-none items-center justify-between gap-2 bg-background-200 pl-4 pr-2 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]">
          <Tabs variant="header" tabs={tabs} selected={s.btab} setSelected={(v) => s.set({ btab: v as BottomTab })} />
          {s.btab === 'c' && (
            <Button type="tertiary" size="small" svgOnly aria-label="Clear Console" tooltip disabled={!s.cons.length} onClick={() => s.set({ cons: [] })}>
              <Trash2 size={16} />
            </Button>
          )}
        </div>
        <div ref={logRef} className="min-h-0 flex-1 overflow-auto">
          {s.btab === 'c' &&
            (s.cons.length ? (
              <div role="log" aria-label="Console" className="py-2 font-mono text-[13px] leading-5">
                {s.cons.map((c) => (
                  <div key={c.id} className="flex gap-4 px-4">
                    <span className="flex-none text-gray-700">{c.time}</span>
                    <span className={cn('whitespace-pre-wrap', c.kind === 'info' ? 'text-gray-900' : c.kind === 'err' ? 'text-red-900' : 'text-gray-1000')}>{c.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No output yet. Run the script to see what it prints.</Empty>
            ))}
          {s.btab === 'p' &&
            (prob ? (
              <div className="flex items-start gap-3 p-4">
                <CircleX size={16} className="mt-0.5 flex-none text-red-900" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="text-sm">"PeakToPeek" is not a MeasurementName. Did you mean "PeakToPeak"?</div>
                  <div className="font-mono text-xs text-gray-900">
                    {s.cur} · Ln {lines.findIndex((l) => /PeakToPeek/.test(l)) + 1}, Col {(lines.find((l) => /PeakToPeek/.test(l)) ?? '').indexOf('PeakToPeek')} · ts(2345)
                  </div>
                </div>
                <Button type="secondary" size="small" prefix={<WandSparkles size={16} />} onClick={s.quickFix}>
                  Quick Fix
                </Button>
              </div>
            ) : (
              <Empty>
                <Check size={16} /> No problems in {s.cur}
              </Empty>
            ))}
          {s.btab === 'v' &&
            (vars.length ? (
              <Table compact caption="Variables" columns={[{ key: 'n', title: 'Name', mono: true }, { key: 'v', title: 'Value', mono: true }, { key: 't', title: 'Type', mono: true }]} rows={vars} rowKey={(v) => v.n} className="[&_table]:shadow-none" />
            ) : (
              <Empty>Pause a script at a breakpoint to inspect its variables.</Empty>
            ))}
        </div>
      </div>

      <FormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New Script"
        submitLabel="Create"
        fields={[
          { key: 'n', label: 'File Name', value: `untitled-${scripts.length - 2}.ts`, required: true, mono: true, validate: (v) => (s.files[/\.ts$/.test(v) ? v : v + '.ts'] ? `${v} already exists. Choose another name.` : /[\s/\\]/.test(v) ? 'Use a name without spaces or slashes' : null) },
          { key: 't', label: 'Template', type: 'select', options: Object.keys(TEMPLATES) }
        ]}
        onSubmit={(v) => {
          s.create(/\.ts$/.test(v.n) ? v.n : v.n + '.ts', v.t)
          setNewOpen(false)
        }}
      />
    </SplitPage>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-[120px] items-center justify-center gap-2 p-4 text-sm text-gray-900">{children}</div>
}
