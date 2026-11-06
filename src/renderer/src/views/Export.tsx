// Export and Logging (board: Export). Data and image export, automatic logging and workspace files.
import { Button, Checkbox, Entity, Fieldset, FormModal, Input, Select, Switch, Toggle, type FormField } from '@robcholz/geist'
import { FileCode, FolderOpen, Layers, Upload } from 'lucide-react'
import { useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { OptionRow, PageBar, ScrollPage } from '../components/Page'
import { useInterval } from '../components/useInterval'
import { useStore } from '../store'

const D = {
  format: 'CSV',
  source: 'All Channels',
  time: 'Seconds',
  decimal: 'Locale',
  header: true,
  comments: true,
  notes: false,
  imgFormat: 'PNG' as 'PNG' | 'SVG',
  imgTheme: 'Current' as 'Current' | 'Light' | 'Dark',
  overlay: true,
  instrument: 'Oscilloscope',
  save: 'Every Capture',
  pattern: 'capture_{index:4}_{date:yyyy-MM-dd_HHmm}.csv',
  folder: '~/Documents/Oscillo/Logs',
  withData: true
}
type E = typeof D
const useExport = create<E & { set: (p: Partial<E>) => void }>()(persist((set) => ({ ...D, set: (p) => set(p) }), { name: 'oscillo.export', partialize: ({ set: _s, ...r }) => r }))

const W = 'w-[200px]'

/** Expand {index:N}, {date:format} and {instrument} in a file name pattern. */
function expand(p: string, index: number, inst: string): string {
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return p
    .replace(/\{index:(\d+)\}/g, (_, n) => pad(index, Number(n)))
    .replace(/\{date:([^}]+)\}/g, (_, f: string) => f.replace('yyyy', String(d.getFullYear())).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())).replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())))
    .replace(/\{instrument\}/g, inst.toLowerCase().replace(/\s+/g, '-'))
}

export function Export() {
  const e = useExport()
  const app = useStore()
  const toast = app.toast
  const [logging, setLogging] = useState(false)
  const [count, setCount] = useState(0)
  const [dialog, setDialog] = useState<null | { title: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => void; description?: string }>(null)
  useInterval(() => setCount((c) => c + 1), 1000, logging && app.running && !!app.device)

  const ext = { CSV: 'csv', TXT: 'txt', 'NI TDMS': 'tdms' }[e.format]
  const sel = (k: keyof E, label: string, options: string[]) => (
    <div className={W}>
      <Select size="small" aria-label={label} value={String(e[k])} options={options} onValueChange={(v) => e.set({ [k]: v } as Partial<E>)} />
    </div>
  )

  return (
    <ScrollPage className="flex max-w-[1120px] flex-col gap-4" bar={<PageBar title="Export and Logging" />}>
      <Fieldset
        title="Export Data"
        subtitle="Oscilloscope · last capture"
        titleSize={16}
        footer={e.source === 'Measurements' ? '6 rows' : `8,192 rows · ${e.source === 'All Channels' ? 3 : 2} columns`}
        actions={
          <Button size="small" onClick={() => toast(`Exported scope.${ext}`, { detail: `${e.source}, ${e.header ? 'with' : 'without'} header.` })}>
            Export Data
          </Button>
        }
        bodyClassName="gap-0"
      >
        <OptionRow label="Format" description="File type for the exported samples.">
          {sel('format', 'Format', ['CSV', 'TXT', 'NI TDMS'])}
        </OptionRow>
        <OptionRow label="Source" description="Which channels or results to write.">
          {sel('source', 'Source', ['All Channels', 'Channel 1', 'Channel 2', 'Measurements'])}
        </OptionRow>
        <OptionRow label="Time Column" description="How each sample is stamped.">
          {sel('time', 'Time Column', ['Seconds', 'Sample Index', 'Clock Time'])}
        </OptionRow>
        <OptionRow label="Decimal" description="Decimal separator for numbers.">
          {sel('decimal', 'Decimal', ['Locale', 'Point'])}
        </OptionRow>
        <OptionRow label="Contents" description="Extra information written above the data.">
          <div className="flex flex-col gap-2">
            <Checkbox checked={e.header} onChange={(header) => e.set({ header })}>Include Header</Checkbox>
            <Checkbox checked={e.comments} onChange={(comments) => e.set({ comments })}>Include Device and Settings Comments</Checkbox>
            <Checkbox checked={e.notes} onChange={(notes) => e.set({ notes })}>Include Notes</Checkbox>
          </div>
        </OptionRow>
      </Fieldset>

      <Fieldset
        title="Export Image"
        subtitle="Instrument view as PNG or SVG."
        titleSize={16}
        actions={
          <Button size="small" onClick={() => toast(`Exported scope.${e.imgFormat.toLowerCase()}`, { detail: `${e.imgTheme} theme${e.overlay ? ', with device and time' : ''}.` })}>
            Export Image
          </Button>
        }
        bodyClassName="gap-0"
      >
        <OptionRow label="Format" description="Raster PNG or vector SVG.">
          <Switch aria-label="Image Format" value={e.imgFormat} options={['PNG', 'SVG'] as const} onChange={(imgFormat) => e.set({ imgFormat })} />
        </OptionRow>
        <OptionRow label="Theme" description="Colours used in the image.">
          <Switch aria-label="Image Theme" value={e.imgTheme} options={['Current', 'Light', 'Dark'] as const} onChange={(imgTheme) => e.set({ imgTheme })} />
        </OptionRow>
        <OptionRow label="Device and Time Overlay" description="Stamp the device name and capture time in a corner.">
          <Toggle checked={e.overlay} aria-label="Device and Time Overlay" onChange={(overlay) => e.set({ overlay })} />
        </OptionRow>
      </Fieldset>

      <Fieldset
        title="Logging"
        subtitle="Save captures automatically while instruments run."
        titleSize={16}
        footer={logging ? `Logging · ${count} files · last ${expand(e.pattern, count, e.instrument)}` : `Next file: ${expand(e.pattern, 1, e.instrument)}`}
        actions={
          <Button
            size="small"
            type={logging ? 'secondary' : 'primary'}
            onClick={() => {
              if (!logging && !app.device) return toast('No device connected', { detail: 'Connect a device, then start logging.' })
              setLogging(!logging)
              if (!logging) setCount(0)
              toast(logging ? 'Logging stopped' : `Logging ${e.instrument}`, { detail: logging ? `${count} files in ${e.folder}.` : `Files go to ${e.folder}.` })
            }}
          >
            {logging ? 'Stop Logging' : 'Start Logging'}
          </Button>
        }
        bodyClassName="gap-0"
      >
        <OptionRow label="Instrument" description="The instrument whose captures are saved.">
          {sel('instrument', 'Instrument', ['Oscilloscope', 'Logic Analyzer', 'Spectrum', 'Network'])}
        </OptionRow>
        <OptionRow label="Save" description="When a new file is written.">
          {sel('save', 'Save', ['Every Capture', 'Every Triggered Capture', 'Manual', 'TypeScript Logic'])}
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
            <Button size="small" type="secondary" prefix={<FolderOpen size={16} />} onClick={() => { e.set({ folder: '~/Desktop/Bench Logs' }); toast('Folder chosen', { detail: '~/Desktop/Bench Logs' }) }}>
              Browse
            </Button>
          </div>
        </OptionRow>
      </Fieldset>

      <Fieldset
        title="Workspace"
        subtitle="Save every open instrument and its state in one file."
        titleSize={16}
        footer={`${app.workspace}.oscillo`}
        actions={
          <>
            <Button size="small" type="secondary" onClick={() => setDialog({ title: 'Save Workspace As', fields: [{ key: 'n', label: 'Name', value: app.workspace, required: true }], submitLabel: 'Save', onSubmit: (v) => { app.setWorkspace(v.n); toast('Workspace saved', { detail: `${v.n}.oscillo` }) } })}>
              Save As
            </Button>
            <Button size="small" onClick={() => toast('Workspace saved', { detail: `${app.workspace}.oscillo${e.withData ? ', with acquisition data' : ''}` })}>
              Save Workspace
            </Button>
          </>
        }
      >
        <Toggle checked={e.withData} onChange={(withData) => e.set({ withData })}>
          Include Acquisition Data
        </Toggle>
        <div className="mt-2 overflow-hidden rounded-small shadow-[0_0_0_1px_var(--gray-alpha-400)]">
          <Entity icon={<FileCode size={16} />} title="Instrument Project" description="Save only the active instrument and its settings.">
            <Button size="small" type="secondary" onClick={() => toast('Saved scope.oscproj')}>Save Project</Button>
          </Entity>
          <Entity icon={<FolderOpen size={16} />} title="Extract Workspace" description="Unpack into a folder of projects and data files.">
            <Button size="small" type="secondary" onClick={() => toast('Workspace extracted', { detail: `~/Documents/${app.workspace}/` })}>Extract</Button>
          </Entity>
          <Entity icon={<Layers size={16} />} title="Compare Workspaces" description="List the settings that differ between two workspaces.">
            <Button size="small" type="secondary" onClick={() => setDialog({ title: 'Compare Workspaces', fields: [{ key: 'a', label: 'First', value: `${app.workspace}.oscillo`, required: true, mono: true }, { key: 'b', label: 'Second', value: 'Filter Lab.oscillo', required: true, mono: true }], submitLabel: 'Compare', onSubmit: (v) => toast('12 settings differ', { detail: `${v.a} and ${v.b}: Scope time base, trigger level and 10 more.` }) })}>
              Compare
            </Button>
          </Entity>
          <Entity icon={<Upload size={16} />} title="Import WaveForms File" description="Convert a workspace or project from Digilent WaveForms." className="shadow-none">
            <Button size="small" type="secondary" onClick={() => setDialog({ title: 'Import WaveForms File', fields: [{ key: 'f', label: 'File', value: 'bench.dwf3work', required: true, mono: true }], submitLabel: 'Import', onSubmit: (v) => toast(`Imported ${v.f}`, { detail: 'Scope, Wavegen and Logic settings converted.' }) })}>
              Import
            </Button>
          </Entity>
        </div>
      </Fieldset>
      {dialog && <FormModal open onClose={() => setDialog(null)} {...dialog} />}
    </ScrollPage>
  )
}
