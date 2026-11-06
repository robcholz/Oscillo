// FPGA Utility. Programs a Xilinx Artix-7 or Spartan-7 over JTAG wired to four DIO pins: scan the
// chain, pick a .bit or .bin, and write the FPGA's configuration memory (src/main/fpga.ts).
import { Badge, Banner, Button, Fieldset, Input, Progress, Select, Table, type BadgeVariant } from '@robcholz/geist'
import { FolderOpen, RefreshCw, TriangleAlert, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BitInfo, ChainDevice, FpgaProgress, JtagPins } from '../../../shared/fpga'
import { OptionRow, PageBar, ScrollPage } from '../components/Page'
import { useStore } from '../store'

const fpga = typeof window !== 'undefined' ? (window.oscillo?.fpga ?? null) : null

const PINS = Array.from({ length: 16 }, (_, i) => `DIO ${i}`)
const CLOCKS = ['1 MHz', '2 MHz', '4 MHz', '8 MHz', '10 MHz']
const SIGNALS = [
  ['tck', 'TCK', 'Test clock.'],
  ['tms', 'TMS', 'Test mode select.'],
  ['tdi', 'TDI', 'Data into the FPGA.'],
  ['tdo', 'TDO', 'Data out of the FPGA.']
] as const

type Result = 'Programmed' | 'Failed'
const RESULT: Record<Result, BadgeVariant> = { Programmed: 'green-subtle', Failed: 'red-subtle' }
interface RunRow {
  w: string
  f: string
  d: string
  t: string
  r: Result
  why?: string
}

const DEFAULTS = {
  pins: { tck: 0, tms: 1, tdi: 2, tdo: 3 } as JtagPins,
  clock: '4 MHz',
  path: '',
  banner: true,
  runs: [] as RunRow[]
}
type FpgaState = typeof DEFAULTS & { set: (p: Partial<typeof DEFAULTS>) => void }
const useFpga = create<FpgaState>()(
  persist((set) => ({ ...DEFAULTS, set: (p) => set(p) }), {
    name: 'oscillo.fpga',
    version: 1,
    // Version 0 kept a simulated board list and runs; start clean.
    migrate: () => DEFAULTS,
    partialize: ({ set: _s, ...r }) => r
  })
)

const PHASE: Record<FpgaProgress['phase'], string> = {
  Connecting: 'Reading the chain…',
  Clearing: 'Clearing the configuration…',
  Programming: 'Sending the bitstream…',
  Starting: 'Starting up…',
  Done: 'Programmed'
}
const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`)
const W = 'w-[220px]'

export function FPGA() {
  const s = useFpga()
  const app = useStore()
  const toast = app.toast
  const [chain, setChain] = useState<{ list: ChainDevice[]; at: number } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [info, setInfo] = useState<BitInfo | null>(null)
  const [fileError, setFileError] = useState('')
  const [prog, setProg] = useState<FpgaProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

  useEffect(() => fpga?.onProgress(setProg), [])
  // Read the header of the remembered file when the page opens.
  useEffect(() => {
    if (s.path) void inspect(s.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inspect = async (path: string): Promise<BitInfo | null> => {
    setFileError('')
    setInfo(null)
    if (!path.trim() || !fpga) return null
    try {
      const i = await fpga.inspect(path.trim())
      setInfo(i)
      return i
    } catch (e) {
      setFileError(plain(e))
      return null
    }
  }

  const ready = (): boolean => {
    if (!fpga) return (toast('Programming needs the desktop app', { detail: 'Open Oscillo to reach the device.' }), false)
    if (!app.device) return (toast('No device connected', { detail: 'Connect a device, then try again.' }), false)
    const v = Object.values(s.pins)
    if (new Set(v).size !== 4) return (toast('Pins overlap', { detail: 'TCK, TMS, TDI and TDO need four different DIO pins.' }), false)
    return true
  }

  const scan = async (): Promise<void> => {
    if (!ready()) return
    setScanning(true)
    try {
      const list = await fpga!.scan(s.pins)
      setChain({ list, at: Date.now() })
      if (!list.length) toast('No JTAG device answered', { detail: 'Check the four wires, a shared ground, and that the board is powered.' })
    } catch (e) {
      toast('Scan failed', { detail: plain(e) })
    } finally {
      setScanning(false)
    }
  }

  const program = async (): Promise<void> => {
    if (!ready()) return
    const i = info ?? (await inspect(s.path))
    if (!i) return void toast('No bitstream selected', { detail: 'Choose a .bit or .bin file from Vivado, then program again.' })
    setBusy(true)
    setFailed('')
    setProg({ phase: 'Connecting', done: 0, total: i.bytes })
    const t0 = Date.now()
    const when = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const add = (r: RunRow) => s.set({ runs: [r, ...useFpga.getState().runs].slice(0, 8) })
    try {
      const r = await fpga!.program(s.pins, i.path, parseFloat(s.clock) * 1e6)
      setProg({ phase: 'Done', done: r.bytes, total: r.bytes })
      add({ w: when, f: i.name, d: r.part, t: `${(r.ms / 1000).toFixed(1)} s`, r: 'Programmed' })
      toast(`Programmed ${i.name}`, { detail: `${r.part} is running the design. It is lost when the board powers off.` })
    } catch (e) {
      const why = plain(e)
      setFailed(why)
      setProg(null)
      add({ w: when, f: i.name, d: chain?.list[0]?.part ?? '—', t: `${((Date.now() - t0) / 1000).toFixed(1)} s`, r: 'Failed', why })
      toast('Programming failed', { detail: why })
    } finally {
      setBusy(false)
    }
  }

  const browse = async (): Promise<void> => {
    if (!fpga) return void toast('Browsing needs the desktop app')
    try {
      const i = await fpga.browse()
      if (!i) return
      s.set({ path: i.path })
      setFileError('')
      setInfo(i)
      setProg(null)
    } catch (e) {
      setFileError(plain(e))
    }
  }

  const pct = prog && prog.total ? Math.round((100 * prog.done) / prog.total) : 0
  const status = failed ? failed : prog ? PHASE[prog.phase] : 'Ready to program'
  const lock = busy || scanning
  const pinOf = (k: keyof JtagPins) => `DIO ${s.pins[k]}`
  const clash = (k: keyof JtagPins) => Object.entries(s.pins).some(([o, v]) => o !== k && v === s.pins[k])

  return (
    <ScrollPage
      className="flex max-w-[1120px] flex-col gap-4"
      bar={
        <>
          <PageBar title="FPGA Utility">
            <Button size="small" prefix={<Upload size={16} />} loading={busy} disabled={lock} onClick={() => void program()}>
              {busy ? 'Programming' : 'Program FPGA'}
            </Button>
          </PageBar>
          {s.banner && (
            <Banner type="warning" icon={<TriangleAlert size={16} />} onClose={() => s.set({ banner: false })}>
              Experimental. Programs Artix-7 and Spartan-7 FPGAs over JTAG on four DIO pins, into configuration memory only, so the design is gone at power-off. Not yet tried on a real board.
            </Banner>
          )}
        </>
      }
    >
      <Fieldset
        titleSize={16}
        title="Connection"
        subtitle="Wire the board's JTAG header to these DIO pins and to ground. The Demo Device has an XC7A35T on DIO 0 to 3."
        footer={chain ? `${chain.list.length} device${chain.list.length === 1 ? '' : 's'} · scanned ${new Date(chain.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Not scanned yet'}
        actions={
          <Button type="secondary" size="small" prefix={<RefreshCw size={16} />} loading={scanning} disabled={lock} onClick={() => void scan()}>
            Scan Chain
          </Button>
        }
      >
        <div className="mb-4">
          {SIGNALS.map(([k, label, desc]) => (
            <OptionRow key={k} label={label} description={clash(k) ? 'Used by another signal. Pick a free pin.' : desc}>
              <div className={W}>
                <Select size="small" aria-label={label} value={pinOf(k)} options={PINS} disabled={lock} onValueChange={(v) => (s.set({ pins: { ...s.pins, [k]: Number(v.slice(4)) } }), setChain(null))} />
              </div>
            </OptionRow>
          ))}
          <OptionRow label="JTAG Clock" description="Bitstream speed. Lower it if programming fails on long wires.">
            <div className={W}>
              <Select size="small" aria-label="JTAG Clock" value={s.clock} options={CLOCKS} disabled={lock} onValueChange={(clock) => s.set({ clock })} />
            </div>
          </OptionRow>
        </div>
        <Table<ChainDevice>
          caption="JTAG chain"
          compact
          columns={[
            { key: 'i', title: '#', width: 40, render: (_, i) => i },
            { key: 'part', title: 'Device', render: (d) => d.part ?? 'Unknown device' },
            { key: 'idcode', title: 'IDCODE', mono: true, render: (d) => '0x' + d.idcode },
            {
              key: 'ok',
              title: 'Support',
              align: 'right',
              render: (d) => (
                <Badge variant={d.part ? 'teal-subtle' : 'gray-subtle'} size="sm">
                  {d.part ? 'Supported' : 'Not supported'}
                </Badge>
              )
            }
          ]}
          rows={chain?.list ?? []}
          rowKey={(d, i) => d.idcode + i}
        />
        {!chain?.list.length && <Empty>{chain ? 'No device answered. Check the wiring and power.' : 'Scan the chain to see what is connected.'}</Empty>}
      </Fieldset>

      <Fieldset
        titleSize={16}
        title="Bitstream"
        subtitle="A .bit or .bin written by Vivado for this FPGA."
        type={fileError ? 'error' : 'default'}
        footer={fileError || (info ? [info.design, info.part, info.date, kb(info.bytes)].filter(Boolean).join(' · ') : 'No file selected')}
      >
        <OptionRow label="File" description="The configuration to load into the FPGA.">
          <div className="flex w-[360px] gap-2">
            <div className="min-w-0 flex-1">
              <Input
                size="small"
                aria-label="File"
                placeholder="~/vivado/top.bit"
                value={s.path}
                disabled={lock}
                onChange={(e) => (s.set({ path: e.target.value }), setInfo(null), setProg(null), setFailed(''))}
                onBlur={() => void inspect(s.path)}
                onKeyDown={(e) => e.key === 'Enter' && void inspect(s.path)}
                className="font-mono"
              />
            </div>
            <Button type="secondary" size="small" prefix={<FolderOpen size={16} />} disabled={lock} onClick={() => void browse()}>
              Browse
            </Button>
          </div>
        </OptionRow>
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex justify-between gap-4 text-[13px] leading-4 text-gray-900">
            <span aria-live="polite" className={failed ? 'text-red-900' : undefined}>
              {status}
            </span>
            <span className="shrink-0 tabular-nums">{prog ? `${kb(prog.done)} of ${kb(prog.total)} · ${pct}%` : ''}</span>
          </div>
          <Progress value={pct} aria-label="Programming progress" />
        </div>
      </Fieldset>

      <Fieldset
        titleSize={16}
        title="Recent Programs"
        subtitle="The last eight runs from this Mac."
        actions={
          s.runs.length > 0 && (
            <Button type="tertiary" size="small" disabled={lock} onClick={() => s.set({ runs: [] })}>
              Clear
            </Button>
          )
        }
      >
        <Table<RunRow>
          caption="Recent programs"
          compact
          columns={[
            { key: 'w', title: 'When' },
            { key: 'f', title: 'File', mono: true },
            { key: 'd', title: 'Device' },
            { key: 't', title: 'Duration', align: 'right' },
            {
              key: 'r',
              title: 'Result',
              align: 'right',
              render: (r) => (
                <span title={r.why}>
                  <Badge variant={RESULT[r.r]} size="sm">
                    {r.r}
                  </Badge>
                </span>
              )
            }
          ]}
          rows={s.runs}
          rowKey={(r, i) => r.w + r.f + i}
        />
        {!s.runs.length && <Empty>Nothing programmed yet.</Empty>}
      </Fieldset>
    </ScrollPage>
  )
}

const Empty = ({ children }: { children: string }) => <p className="py-3 text-center text-[13px] text-gray-900">{children}</p>

/** The reason from an IPC error, without Electron's "Error invoking remote method" prefix. */
const plain = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
