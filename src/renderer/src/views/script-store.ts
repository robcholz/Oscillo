// Script workspace: files, breakpoints and run options persist; the run itself and the console don't.
// Scripts are type-checked and run by the main process (src/main/script.ts) against the connected
// device; this store drives it and collects its console, pauses and problems.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { OSCILLO_DTS } from '../../../shared/oscillo-types'
import type { Problem, ScriptEvent, ScriptVar } from '../../../shared/script'
import type { WaveType } from '../sim/wave'
import { useStore } from '../store'
import { useSupplies } from './Supplies'
import { useWavegen } from './Wavegen'

export const FILES: Record<string, string> = {
  'frequency-sweep.ts': `import { scope, wavegen, File } from "oscillo";

wavegen.channel(1).configure({ type: "Sine", frequency: 1e3, amplitude: 2 });
await wavegen.channel(1).run();
const log = new File("sweep.csv");

for (let f = 100; f <= 10_000; f *= 2) {
  wavegen.channel(1).frequency = f;
  const capture = await scope.single();
  const vpp = capture.channel(1).measure("PeakToPeek");
  log.appendLine(\`\${f},\${vpp}\`);
}`,
  'log-supply.ts': `import { supplies, wait, File } from "oscillo";

const log = new File("supply.csv");
supplies.positive.set({ voltage: 3.3, enable: true });

for (let i = 0; i < 60; i++) {
  const r = supplies.positive.read();
  log.appendLine(\`\${i},\${r.voltage},\${r.current}\`);
  await wait(1000);
}`,
  'spi-decoder.ts': `import { logic } from "oscillo";

const spi = logic.interpreter("SPI", { clock: 0, select: 3, mosi: 1, miso: 2 });
const capture = await logic.single();

for (const frame of spi.decode(capture)) {
  console.log(frame.time, frame.mosi.hex(), frame.miso.hex());
}`,
  'units.ts': `export const kHz = 1e3;
export const MHz = 1e6;
export const mV = 1e-3;
export const ms = 1e-3;`,
  'oscillo.d.ts': OSCILLO_DTS
}
export const LIB = ['units.ts']
export const TYPES = ['oscillo.d.ts']
const SWEEP = 'frequency-sweep.ts'

export const TEMPLATES: Record<string, string> = {
  Empty: 'import { } from "oscillo";\n',
  'Scope Capture': 'import { scope } from "oscillo";\n\nconst capture = await scope.single();\nconsole.log(capture.channel(1).measure("Frequency"));',
  'Supply Ramp': 'import { supplies, wait } from "oscillo";\n\nfor (let v = 0; v <= 5; v += 0.5) {\n  supplies.positive.set({ voltage: v, enable: true });\n  await wait(200);\n}'
}

export type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'stopped' | 'failed'
export interface Run {
  status: RunStatus
  line: number
  file: string
  vars: ScriptVar[]
}
export interface ConsoleLine {
  id: number
  time: string
  text: string
  kind: 'info' | 'out' | 'err'
}
export type BottomTab = 'c' | 'p' | 'v'

const OPTS = { tc: true, timeout: '30 s', sandbox: 'Isolated', modules: 'Built-in Only', compat: 'Oscillo API' }
type Opts = typeof OPTS

interface ScriptState extends Opts {
  files: Record<string, string>
  open: string[]
  cur: string
  bps: Record<string, number[]>
  run: Run
  cons: ConsoleLine[]
  btab: BottomTab
  editing: boolean
  /** Type-check results by file. */
  problems: Record<string, Problem[]>
  set: (p: Partial<ScriptState>) => void
  openFile: (name: string) => void
  closeTab: () => void
  toggleBp: (line: number) => void
  edit: (code: string) => void
  create: (name: string, template: string) => boolean
  runOrContinue: () => void
  step: () => void
  stop: () => void
  abort: () => void
  quickFix: (p?: Problem) => void
  checkNow: (file?: string) => Promise<Problem[]>
}

let lineId = 0
const stamp = (): string => new Date().toTimeString().slice(0, 8)
const line = (text: string, kind: ConsoleLine['kind'] = 'out'): ConsoleLine => ({ id: ++lineId, time: stamp(), text, kind })
const toast = (title: string, detail?: string): void => useStore.getState().toast(title, detail ? { detail } : undefined)
const api = typeof window !== 'undefined' ? (window.oscillo?.script ?? null) : null
const TIMEOUT: Record<string, number> = { '30 s': 30, '5 min': 300, None: 0 }

const WAVE: Record<string, WaveType> = { RampUp: 'Ramp Up', RampDown: 'Ramp Down', SinePower: 'Sine Power', Pulse: 'Square' }

/** A script changed an instrument: show it on that instrument's page. */
function applyToPages(e: Extract<ScriptEvent, { type: 'apply' }>['apply']): void {
  if (e.kind === 'wavegen') {
    const i = e.channel as 0 | 1
    useWavegen.getState().setCh(i, {
      run: e.run,
      out: true,
      ...(e.type ? { type: WAVE[e.type] ?? (e.type as WaveType) } : {}),
      ...(e.freq !== undefined ? { freq: e.freq, amp: e.amp!, offset: e.offset!, sym: e.sym!, phase: e.phase! } : {})
    })
  } else if (e.kind === 'supplies') {
    const s = useSupplies.getState()
    s.set({ master: e.master, pos: { ...s.pos, ...e.pos }, neg: { ...s.neg, ...e.neg } })
  }
}

export const useScript = create<ScriptState>()(
  persist(
    (set, get) => {
      let checkTimer: ReturnType<typeof setTimeout> | undefined
      return {
        ...OPTS,
        files: FILES,
        open: [SWEEP, 'log-supply.ts'],
        cur: SWEEP,
        bps: { [SWEEP]: [9] },
        run: { status: 'idle', line: 0, file: SWEEP, vars: [] },
        cons: [],
        btab: 'c',
        editing: false,
        problems: {},
        set: (p) => set(p),
        openFile: (name) => {
          set((s) => ({ cur: name, open: s.open.includes(name) ? s.open : [...s.open, name], editing: false }))
          void get().checkNow(name)
        },
        closeTab: () =>
          set((s) => {
            const open = s.open.filter((f) => f !== s.cur)
            return open.length ? { open, cur: open[open.length - 1], editing: false } : {}
          }),
        toggleBp: (n) => {
          set((s) => {
            const bps = s.bps[s.cur] ?? []
            return { bps: { ...s.bps, [s.cur]: bps.includes(n) ? bps.filter((x) => x !== n) : [...bps, n] } }
          })
          void api?.breakpoints(get().bps)
        },
        edit: (code) => {
          set((s) => ({ files: { ...s.files, [s.cur]: code } }))
          clearTimeout(checkTimer)
          checkTimer = setTimeout(() => void get().checkNow(), 400)
        },
        create: (name, template) => {
          const s = get()
          if (s.files[name]) return false
          set({ files: { ...s.files, [name]: TEMPLATES[template] ?? TEMPLATES.Empty }, cur: name, open: [...s.open, name], editing: true })
          return true
        },
        checkNow: async (file) => {
          const s = get()
          const name = file ?? s.cur
          if (!api || TYPES.includes(name)) return []
          const problems = await api.check(s.files, name)
          // Problems in imported files are kept under their own file.
          const byFile: Record<string, Problem[]> = { [name]: [] }
          for (const p of problems) (byFile[p.file] ??= []).push(p)
          set((x) => ({ problems: { ...x.problems, ...byFile } }))
          return problems
        },
        runOrContinue: async () => {
          const s = get()
          const app = useStore.getState()
          if (s.run.status === 'paused') return void api?.resume(false)
          if (s.run.status === 'running') return toast('A script is already running', 'Stop it first.')
          const name = s.cur
          if (LIB.includes(name) || TYPES.includes(name)) return toast(`${name} is a module`, 'It has nothing to run. Open a script in the scripts folder.')
          if (!api) return toast('Scripts run in the desktop app')
          if (!app.device) return toast('No device connected', 'Connect a device, then run the script.')
          if (s.tc) {
            const problems = await get().checkNow(name)
            if (problems.length) {
              set({ btab: 'p' })
              return toast(`Type check found ${problems.length} problem${problems.length > 1 ? 's' : ''} in ${name}`, 'Fix them in Problems, then run again.')
            }
          }
          if (s.modules !== 'Built-in Only') toast('npm imports are not available yet', 'Scripts can import "oscillo" and files in this workspace.')
          set({ run: { status: 'running', line: 0, file: name, vars: [] }, btab: 'c', cons: [...s.cons, line(`Running ${name}`, 'info')].slice(-500) })
          try {
            await api.run(s.files, name, { timeout: TIMEOUT[s.timeout] ?? 30, breakpoints: s.bps, network: s.sandbox === 'Allow Network', anyPath: s.sandbox !== 'Isolated' })
          } catch (e) {
            const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
            set((x) => ({ run: { ...x.run, status: 'failed' }, cons: [...x.cons, line(msg, 'err')] }))
          }
        },
        step: () => void api?.resume(true),
        stop: () => void api?.stop(false),
        abort: () => {
          void api?.stop(true)
          toast('Script aborted, outputs reset')
        },
        quickFix: (p) => {
          const s = get()
          const fix = (p ?? (s.problems[s.cur] ?? []).find((x) => x.fix))?.fix
          if (!fix) return
          const file = p?.file ?? s.cur
          const code = s.files[file]
          set({ files: { ...s.files, [file]: code.slice(0, fix.start) + fix.text + code.slice(fix.end) } })
          toast(fix.title)
          void get().checkNow(file)
        }
      }
    },
    {
      name: 'oscillo.script',
      version: 2,
      partialize: (s) => ({ files: s.files, open: s.open, cur: s.cur, bps: s.bps, tc: s.tc, timeout: s.timeout, sandbox: s.sandbox, modules: s.modules, compat: s.compat }),
      // The API types always come from the app, never from storage.
      merge: (saved, cur) => {
        const p = (saved ?? {}) as Partial<ScriptState>
        return { ...cur, ...p, files: { ...cur.files, ...(p.files ?? {}), 'oscillo.d.ts': OSCILLO_DTS } }
      }
    }
  )
)

// Keep a copy on disk (Documents/Oscillo/Scripts) so scripts also run from a terminal.
if (api) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last: Record<string, string> | null = null
  const save = (): void => {
    const files = useScript.getState().files
    if (files === last) return
    last = files
    clearTimeout(timer)
    timer = setTimeout(() => void api.sync(files), 1000)
  }
  useScript.subscribe(save)
  setTimeout(save, 0)
}

// Events from the running script.
api?.onEvent((e) => {
  const add = (l: ConsoleLine) => useScript.setState((x) => ({ cons: [...x.cons, l].slice(-500) }))
  if (e.type === 'console') add(line(e.text, e.kind))
  else if (e.type === 'apply') applyToPages(e.apply)
  else if (e.type === 'paused') {
    useScript.setState((x) => ({
      run: { status: 'paused', line: e.line, file: e.file, vars: e.vars },
      cur: e.file,
      open: x.open.includes(e.file) ? x.open : [...x.open, e.file],
      editing: false
    }))
    add(line(`Paused at ${e.file}:${e.line}`, 'info'))
  } else if (e.type === 'resumed') useScript.setState((x) => ({ run: { ...x.run, status: 'running' } }))
  else if (e.type === 'done') {
    const status: RunStatus = e.ok ? 'done' : e.stopped ? 'stopped' : 'failed'
    useScript.setState((x) => ({ run: { status, line: e.line ?? 0, file: e.file || x.run.file, vars: [] } }))
    if (e.stopped) add(line(`Stopped at ${e.file}:${e.line}`, 'info'))
    if (status === 'failed') toast(`Script failed${e.line ? ` at line ${e.line}` : ''}`, e.error)
  }
})
