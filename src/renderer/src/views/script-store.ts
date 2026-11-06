// Script workspace: files, breakpoints and run options persist; the run itself and the console don't.
// The run is a line-by-line model of frequency-sweep.ts so breakpoints, stepping and variables behave.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useStore } from '../store'

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
  'oscillo.d.ts': `declare module "oscillo" {
  export const scope: Scope;
  export const wavegen: Wavegen;
  export const supplies: Supplies;
  export const logic: Logic;
}`
}
export const LIB = ['units.ts']
export const TYPES = ['oscillo.d.ts']
const SWEEP = 'frequency-sweep.ts'

export const TEMPLATES: Record<string, string> = {
  Empty: 'import { } from "oscillo";\n',
  'Scope Capture': 'import { scope } from "oscillo";\n\nconst capture = await scope.single();\nconsole.log(capture.channel(1).measure("Frequency"));',
  'Supply Ramp': 'import { supplies, wait } from "oscillo";\n\nfor (let v = 0; v <= 5; v += 0.5) {\n  supplies.positive.set({ voltage: v, enable: true });\n  await wait(200);\n}'
}

export type RunStatus = 'idle' | 'paused' | 'done' | 'stopped' | 'failed'
export interface Run {
  status: RunStatus
  line: number
  f: number
  vpp: string | null
  file: string
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
  quickFix: () => void
}

let lineId = 0
const stamp = (): string => new Date().toTimeString().slice(0, 8)
const line = (text: string, kind: ConsoleLine['kind'] = 'out'): ConsoleLine => ({ id: ++lineId, time: stamp(), text, kind })
export const hasProblem = (code: string): boolean => /PeakToPeek/.test(code)
const toast = (title: string, detail?: string): void => useStore.getState().toast(title, detail ? { detail } : undefined)

/** One step of the sweep model. Returns the next run state and any printed output. */
function stepOnce(r: Run, code: string): { r: Run; out?: string } {
  const n = { ...r }
  const L = n.line
  if (L < 7) return { r: { ...n, line: L < 3 ? 3 : L === 3 ? 4 : L === 4 ? 5 : 7 } }
  if (L === 7) return n.f > 10000 ? { r: { ...n, line: 12, status: 'done' } } : { r: { ...n, line: 8 } }
  if (L === 8 || L === 9) return { r: { ...n, line: L + 1 } }
  if (L === 10) {
    if (hasProblem(code)) return { r: { ...n, status: 'failed' } }
    return { r: { ...n, vpp: (3.98 / Math.sqrt(1 + (n.f / 4000) ** 2)).toFixed(3), line: 11 } }
  }
  if (L === 11) return { r: { ...n, f: n.f * 2, line: 7 }, out: `${n.f},${n.vpp}` }
  return { r: { ...n, status: 'done' } }
}

export const useScript = create<ScriptState>()(
  persist(
    (set, get) => {
      const advance = (untilBp: boolean, start?: Run, pre: ConsoleLine[] = []): void => {
        const s = get()
        let r: Run = { ...(start ?? s.run), status: 'paused' }
        const out = pre
        const bps = s.bps[r.file] ?? []
        for (let k = 0; k < 400; k++) {
          const next = stepOnce(r, s.files[r.file] ?? '')
          r = next.r
          if (next.out) out.push(line(next.out))
          if (r.status !== 'paused') break
          if (!untilBp || bps.includes(r.line)) break
        }
        if (r.status === 'failed') out.push(line(`TypeError: "PeakToPeek" is not a MeasurementName (${r.file}:10)`, 'err'))
        else if (r.status === 'done') out.push(line('Finished. Wrote sweep.csv', 'info'))
        else if (untilBp) out.push(line(`Paused at breakpoint, line ${r.line}`, 'info'))
        set({ run: r, cons: [...s.cons, ...out].slice(-200), btab: r.status === 'failed' ? 'p' : out.length ? 'c' : s.btab })
        if (r.status === 'failed') toast('Script failed at line 10', 'Open Problems to see the error.')
      }
      return {
        ...OPTS,
        files: FILES,
        open: [SWEEP, 'log-supply.ts'],
        cur: SWEEP,
        bps: { [SWEEP]: [9] },
        run: { status: 'idle', line: 0, f: 100, vpp: null, file: SWEEP },
        cons: [],
        btab: 'c',
        editing: false,
        set: (p) => set(p),
        openFile: (name) => set((s) => ({ cur: name, open: s.open.includes(name) ? s.open : [...s.open, name], editing: false })),
        closeTab: () =>
          set((s) => {
            const open = s.open.filter((f) => f !== s.cur)
            return open.length ? { open, cur: open[open.length - 1], editing: false } : {}
          }),
        toggleBp: (n) =>
          set((s) => {
            const bps = s.bps[s.cur] ?? []
            return { bps: { ...s.bps, [s.cur]: bps.includes(n) ? bps.filter((x) => x !== n) : [...bps, n] } }
          }),
        edit: (code) => set((s) => ({ files: { ...s.files, [s.cur]: code } })),
        create: (name, template) => {
          const s = get()
          if (s.files[name]) return false
          set({ files: { ...s.files, [name]: TEMPLATES[template] ?? TEMPLATES.Empty }, cur: name, open: [...s.open, name], editing: true })
          return true
        },
        runOrContinue: () => {
          const s = get()
          const app = useStore.getState()
          if (s.run.status === 'paused') return advance(true)
          const name = s.cur
          if (LIB.includes(name) || TYPES.includes(name)) return toast(`${name} is a module`, 'It has nothing to run. Open a script in the scripts folder.')
          if (s.tc && hasProblem(s.files[name])) {
            set({ btab: 'p' })
            return toast(`Type check found 1 problem in ${name}`, 'Fix it in Problems, then run again.')
          }
          if (!app.device) return toast('No device connected', 'Connect a device, then run the script.')
          const pre = [line(`Running ${name}`, 'info')]
          if (name === SWEEP) return advance(true, { status: 'paused', line: 1, f: 100, vpp: null, file: name }, pre)
          const spi = name === 'spi-decoder.ts'
          set({
            run: { status: 'done', line: 0, f: 0, vpp: null, file: name },
            btab: 'c',
            cons: [...s.cons, ...pre, line(spi ? '0.000012 9F FF' : '0,3.301,0.012'), line(spi ? '0.000020 00 EF' : '1,3.300,0.012'), line('Finished in 0.4 s', 'info')].slice(-200)
          })
        },
        step: () => advance(false),
        stop: () => set((s) => ({ run: { ...s.run, status: 'stopped' }, cons: [...s.cons, line(`Stopped by user at line ${s.run.line}`, 'info')] })),
        abort: () => {
          set((s) => ({ run: { ...s.run, status: 'stopped' }, cons: [...s.cons, line('Aborted. Outputs were reset to idle.', 'err')] }))
          toast('Script aborted, outputs reset')
        },
        quickFix: () => {
          set((s) => ({ files: { ...s.files, [s.cur]: s.files[s.cur].replace(/PeakToPeek/g, 'PeakToPeak') }, run: s.run.status === 'failed' ? { ...s.run, status: 'stopped' } : s.run }))
          toast('Replaced "PeakToPeek" with "PeakToPeak"')
        }
      }
    },
    {
      name: 'oscillo.script',
      partialize: (s) => ({ files: s.files, open: s.open, cur: s.cur, bps: s.bps, tc: s.tc, timeout: s.timeout, sandbox: s.sandbox, modules: s.modules, compat: s.compat })
    }
  )
)
