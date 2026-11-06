// Export and Logging (board: Export). Data and image export, automatic logging and workspace files.
import { Button, Checkbox, Entity, Fieldset, FormModal, Input, Modal, Select, Switch, Table, Toggle, type FormField } from '@robcholz/geist'
import { FileCode, FolderInput, FolderOpen, Layers } from 'lucide-react'
import { useState } from 'react'
import { OptionRow, PageBar, ScrollPage } from '../components/Page'
import { deviceById } from '../devices'
import { files, INSTRUMENTS, pageOf, saveImage, saveTable, useLatest, type CsvOpts, type Instrument } from '../files'
import { expand, logNow, startLogging, stopLogging, useLogging } from '../logging'
import { useStore } from '../store'
import { compareWithFile, extractWorkspace, openWorkspace, saveProject, saveWorkspace, useRecent, type Difference } from '../workspace'
import { useExport, type E } from './export-store'
import { useScope } from './scope-store'

const W = 'w-[200px]'

export function Export() {
  const e = useExport()
  const app = useStore()
  const toast = app.toast
  const log = useLogging()
  const path = useRecent((r) => r.path)
  const notes = useScope((s) => s.notes)
  const latest = useLatest(e.dataInstrument)
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void; description?: string }>(null)
  const [diff, setDiff] = useState<null | { name: string; diffs: Difference[] }>(null)
  const [busy, setBusy] = useState(false)

  const dev = deviceById(app.device)
  const sources = ['All Columns', ...(latest?.columns.slice(1) ?? [])]
  const source = sources.includes(e.source) ? e.source : 'All Columns'
  const csv = (): CsvOpts => ({
    format: e.format,
    time: e.time,
    decimal: e.decimal,
    header: e.header,
    comments: e.comments ? { Instrument: e.dataInstrument, Device: dev ? `${dev.name} ${dev.serial}` : 'None', Captured: new Date(latest?.at ?? Date.now()).toISOString(), ...latest?.meta } : null,
    notes: e.notes && e.dataInstrument === 'Oscilloscope' ? notes : undefined,
    only: source === 'All Columns' ? undefined : [source]
  })
  const ext = e.format === 'TXT' ? 'txt' : 'csv'
  const slug = (i: Instrument) => i.toLowerCase().replace(/\s+/g, '-')

  const sel = <K extends keyof E>(k: K, label: string, options: readonly string[], value = String(e[k])) => (
    <div className={W}>
      <Select size="small" aria-label={label} value={value} options={[...options]} onValueChange={(v) => e.set({ [k]: v } as Partial<E>)} />
    </div>
  )

  const toggleLogging = () => {
    if (log.on) {
      stopLogging()
      return toast('Logging stopped', { detail: `${log.count} ${log.count === 1 ? 'file' : 'files'} in ${e.folder}.` })
    }
    if (!app.device) return toast('No device connected', { detail: 'Connect a device, then start logging.' })
    startLogging({ instrument: e.instrument, when: e.save, pattern: e.pattern, folder: e.folder, csv: { ...csv(), only: undefined, comments: null } })
    toast(`Logging ${e.instrument}`, { detail: e.save === 'Manual' ? 'Press Save Now to write each file.' : `A file per ${e.save === 'Every Capture' ? 'capture' : 'triggered capture'} goes to ${e.folder}.` })
  }

  const footer = log.on
    ? `Logging ${log.instrument} · ${log.count} ${log.count === 1 ? 'file' : 'files'}${log.last ? ` · last ${log.last.split(/[\\/]/).pop()}` : ''}`
    : log.error
      ? `Stopped: ${log.error}`
      : `Next file: ${expand(e.pattern, 1, e.instrument)}`

  return (
    <ScrollPage className="flex max-w-[1120px] flex-col gap-4" bar={<PageBar title="Export and Logging" />}>
      <Fieldset
        title="Export Data"
        subtitle={`${e.dataInstrument} · last capture`}
        titleSize={16}
        footer={latest ? `${latest.data[0].length.toLocaleString()} rows · ${source === 'All Columns' ? latest.columns.length : 2} columns · captured ${new Date(latest.at).toLocaleTimeString()}` : `No ${e.dataInstrument} capture yet. Run it first.`}
        actions={
          <Button size="small" disabled={!latest} onClick={() => void saveTable(`${slug(e.dataInstrument)}.${ext}`, latest, csv())}>
            Export Data
          </Button>
        }
        bodyClassName="gap-0"
      >
        <OptionRow label="Instrument" description="Whose last capture is written.">
          {sel('dataInstrument', 'Instrument', INSTRUMENTS)}
        </OptionRow>
        <OptionRow label="Source" description="Every column, or one channel or trace.">
          {sel('source', 'Source', sources, source)}
        </OptionRow>
        <OptionRow label="Format" description="Comma-separated or tab-separated text.">
          {sel('format', 'Format', ['CSV', 'TXT'])}
        </OptionRow>
        <OptionRow label="First Column" description="How each row is stamped.">
          {sel('time', 'First Column', ['Seconds', 'Sample Index', 'Clock Time'])}
        </OptionRow>
        <OptionRow label="Decimal" description="Locale uses a comma where your region does, with semicolons between columns.">
          {sel('decimal', 'Decimal', ['Locale', 'Point'])}
        </OptionRow>
        <OptionRow label="Contents" description="Extra lines written above the data, starting with #.">
          <div className="flex flex-col gap-2">
            <Checkbox checked={e.header} onChange={(header) => e.set({ header })}>Include Header</Checkbox>
            <Checkbox checked={e.comments} onChange={(comments) => e.set({ comments })}>Include Device and Settings Comments</Checkbox>
            <Checkbox checked={e.notes} onChange={(n) => e.set({ notes: n })}>Include Scope Notes</Checkbox>
          </div>
        </OptionRow>
      </Fieldset>

      <Fieldset
        title="Export Image"
        subtitle={`The ${e.dataInstrument} page as PNG.`}
        titleSize={16}
        actions={
          <Button
            size="small"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              await saveImage(`${slug(e.dataInstrument)}.png`, { page: pageOf(e.dataInstrument), theme: e.imgTheme, overlay: e.overlay ? `${dev?.name ?? 'No Device'} · ${new Date().toLocaleString()}` : null })
              setBusy(false)
            }}
          >
            Export Image
          </Button>
        }
        bodyClassName="gap-0"
      >
        <OptionRow label="Theme" description="Colours used in the image.">
          <Switch aria-label="Image Theme" value={e.imgTheme} options={['Current', 'Light', 'Dark'] as const} onChange={(imgTheme) => e.set({ imgTheme })} />
        </OptionRow>
        <OptionRow label="Device and Time Overlay" description="Stamp the device name and time in a corner.">
          <Toggle checked={e.overlay} aria-label="Device and Time Overlay" onChange={(overlay) => e.set({ overlay })} />
        </OptionRow>
      </Fieldset>

      <Fieldset
        title="Logging"
        subtitle="Save captures automatically while instruments run. Scripts can also write files with File."
        titleSize={16}
        footer={footer}
        actions={
          <>
            {log.on && (
              <Button size="small" type="secondary" onClick={() => void logNow()}>
                Save Now
              </Button>
            )}
            <Button size="small" type={log.on ? 'secondary' : 'primary'} onClick={toggleLogging}>
              {log.on ? 'Stop Logging' : 'Start Logging'}
            </Button>
          </>
        }
        bodyClassName="gap-0"
      >
        <OptionRow label="Instrument" description="The instrument whose captures are saved. Keep its page running.">
          {sel('instrument', 'Instrument', INSTRUMENTS)}
        </OptionRow>
        <OptionRow label="Save" description="When a new file is written.">
          {sel('save', 'Save', ['Every Capture', 'Every Triggered Capture', 'Manual'])}
        </OptionRow>
        <OptionRow label="File Name Pattern" description="Tokens: {index:N}, {date:format}, {instrument}.">
          <div className="w-[320px]">
            <Input size="small" aria-label="File Name Pattern" className="font-mono" value={e.pattern} onChange={(x) => e.set({ pattern: x.target.value })} />
          </div>
        </OptionRow>
        <OptionRow label="Folder" description="Where log files are saved.">
          <div className="flex w-[320px] gap-2">
            <div className="min-w-0 flex-1">
              <Input size="small" aria-label="Folder" value={e.folder} onChange={(x) => e.set({ folder: x.target.value })} />
            </div>
            <Button
              size="small"
              type="secondary"
              prefix={<FolderOpen size={16} />}
              onClick={async () => {
                const f = await files?.folder(e.folder)
                if (f) e.set({ folder: f })
              }}
            >
              Browse
            </Button>
          </div>
        </OptionRow>
      </Fieldset>

      <Fieldset
        title="Workspace"
        subtitle="Every instrument's settings in one file."
        titleSize={16}
        footer={path ?? `${app.workspace}.oscillo · not saved yet`}
        actions={
          <>
            <Button size="small" type="secondary" onClick={() => setDialog({ title: 'Save Workspace As', fields: [{ key: 'n', label: 'Name', value: app.workspace, required: true }], submitLabel: 'Choose Location', onSubmit: (v) => void saveWorkspace({ as: true, name: v.n }) })}>
              Save As
            </Button>
            <Button size="small" onClick={() => void saveWorkspace()}>
              Save Workspace
            </Button>
          </>
        }
      >
        <Toggle checked={e.withData} onChange={(withData) => e.set({ withData })}>
          Include Each Instrument's Last Capture
        </Toggle>
        <div className="mt-2 overflow-hidden rounded-small shadow-[0_0_0_1px_var(--gray-alpha-400)]">
          <Entity icon={<FolderInput size={16} />} title="Open Workspace" description="Open a workspace, or load one instrument's project into this one.">
            <Button size="small" type="secondary" onClick={() => void openWorkspace()}>Open</Button>
          </Entity>
          <Entity icon={<FileCode size={16} />} title="Instrument Project" description={`Save only the ${e.dataInstrument} settings, to load into another workspace.`}>
            <Button size="small" type="secondary" onClick={() => void saveProject(pageOf(e.dataInstrument))}>Save Project</Button>
          </Entity>
          <Entity icon={<FolderOpen size={16} />} title="Extract Workspace" description="Write each instrument's settings and last capture as separate files in a folder.">
            <Button size="small" type="secondary" onClick={() => void extractWorkspace()}>Extract</Button>
          </Entity>
          <Entity icon={<Layers size={16} />} title="Compare Workspaces" description="List the settings that differ between this workspace and a saved one." className="shadow-none">
            <Button size="small" type="secondary" onClick={async () => setDiff(await compareWithFile())}>
              Compare
            </Button>
          </Entity>
        </div>
      </Fieldset>
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
      {diff && (
        <Modal
          open
          width={640}
          onClose={() => setDiff(null)}
          title="Compare Workspaces"
          description={diff.diffs.length ? `${diff.diffs.length} ${diff.diffs.length === 1 ? 'setting differs' : 'settings differ'} between ${app.workspace} and ${diff.name}.` : `${app.workspace} and ${diff.name} have the same settings.`}
          actions={
            <Button size="small" onClick={() => setDiff(null)}>
              Done
            </Button>
          }
        >
          {diff.diffs.length > 0 && (
            <div className="max-h-[360px] overflow-auto">
              <Table
                caption="Settings that differ"
                columns={[
                  { key: 'setting', title: 'Setting' },
                  { key: 'a', title: app.workspace },
                  { key: 'b', title: diff.name }
                ]}
                rows={diff.diffs}
                rowKey={(r) => r.setting}
              />
            </div>
          )}
        </Modal>
      )}
    </ScrollPage>
  )
}
