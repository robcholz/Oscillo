// Runs Script's TypeScript (checked and compiled by script-compile.ts) in a VM context with only the
// Oscillo API, console and timers, pausing at breakpoints and steps.
import { app, ipcMain, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { inspect } from 'node:util'
import vm from 'node:vm'
import ts from 'typescript'
import { SCRIPT, type RunOptions, type ScriptEvent, type ScriptVar } from '../shared/script'
import { createApi, describe } from './api'
import { check, compile } from './script-compile'
import type { Hardware } from './hardware'

class Stop extends Error {}

/** One script run with its debugger state. */
class Run {
  private stopped = false
  private stepping = false
  private resumeFn: (() => void) | null = null
  private hooks = 0
  private deadline: number
  at = { file: '', line: 0 }

  constructor(
    private emit: (e: ScriptEvent) => void,
    public bps: Record<string, number[]>,
    timeout: number
  ) {
    this.deadline = timeout ? Date.now() + timeout * 1000 : Infinity
  }

  /** Called before each statement. Pauses at breakpoints and steps; stops when asked. */
  line = async (file: string, line: number, vars: () => Record<string, unknown>): Promise<void> => {
    if (this.stopped) throw new Stop()
    if (Date.now() > this.deadline) throw new Error('The script ran past its timeout')
    this.at = { file, line }
    if (++this.hooks % 500 === 0) await new Promise((r) => setImmediate(r))
    if (!this.stepping && !this.bps[file]?.includes(line)) return
    let v: ScriptVar[] = []
    try {
      v = Object.entries(vars()).map(([n, x]) => ({ n, ...describe(x) }))
    } catch {
      /* a variable in its temporal dead zone */
    }
    this.emit({ type: 'paused', file, line, vars: v })
    await new Promise<void>((r) => (this.resumeFn = r))
    if (this.stopped) throw new Stop()
    this.emit({ type: 'resumed' })
  }

  resume(step: boolean): void {
    this.stepping = step
    const r = this.resumeFn
    this.resumeFn = null
    r?.()
  }

  stop(): void {
    this.stopped = true
    this.resume(false)
  }
}

export function registerScript(hw: Hardware): void {
  let run: Run | null = null
  const dataDir = join(app.getPath('documents'), 'Oscillo')

  ipcMain.handle(SCRIPT.check, (_e, files: Record<string, string>, file: string) => check(files, file))
  ipcMain.handle(SCRIPT.folder, async () => {
    await shell.openPath(dataDir)
    return dataDir
  })
  ipcMain.handle(SCRIPT.resume, (_e, step: boolean) => run?.resume(step))
  ipcMain.handle(SCRIPT.breakpoints, (_e, bps: Record<string, number[]>) => {
    if (run) run.bps = bps
  })
  ipcMain.handle(SCRIPT.stop, async (_e, abort: boolean) => {
    run?.stop()
    if (abort) {
      // Outputs back to idle.
      await Promise.allSettled([0, 1].map(async (c) => hw.wavegenStop(c)))
      try {
        hw.supplies({ master: false, pos: { on: false, volts: 0 }, neg: { on: false, volts: 0 } })
        hw.dioWrite(0, 0)
        hw.patternsStop()
      } catch {
        /* no device */
      }
    }
  })
  ipcMain.handle(SCRIPT.run, async (e, files: Record<string, string>, entry: string, opts: RunOptions) => {
    if (run) throw new Error('A script is already running')
    const sender: WebContents = e.sender
    const emit = (ev: ScriptEvent) => !sender.isDestroyed() && sender.send(SCRIPT.event, ev)
    const r = new Run(emit, opts.breakpoints, opts.timeout)
    run = r
    const wrote = new Set<string>()
    const api = createApi({ hw, dataDir, apply: (apply) => emit({ type: 'apply', apply }), wrote: (p) => wrote.add(p) })
    const print = (kind: 'out' | 'err') => (...a: unknown[]) => emit({ type: 'console', kind, text: a.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 2, breakLength: 120 }))).join(' ') })
    const context = vm.createContext({
      console: { log: print('out'), info: print('out'), warn: print('err'), error: print('err') },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      __rt: { line: r.line },
      ...(opts.network ? { fetch } : {})
    })
    const started = Date.now()
    try {
      // Workspace modules are compiled and run first, in import order, so require() can return them.
      const exportsOf = new Map<string, Record<string, unknown>>()
      const load = async (file: string, chain: string[]): Promise<Record<string, unknown>> => {
        if (exportsOf.has(file)) return exportsOf.get(file)!
        if (chain.includes(file)) throw new Error(`Circular import: ${[...chain, file].join(' → ')}`)
        const code = files[file]
        if (code === undefined) throw new Error(`Cannot find ${file}`)
        const deps = ts.preProcessFile(code, true, false).importedFiles.map((i) => i.fileName)
        const local: Record<string, Record<string, unknown>> = {}
        for (const d of deps) {
          if (d === 'oscillo') continue
          if (!d.startsWith('./')) throw new Error(`Only "oscillo" and files in this workspace can be imported, not "${d}"`)
          const name = d.slice(2).replace(/(\.ts)?$/, '.ts')
          local[d] = await load(name, [...chain, file])
        }
        const exports: Record<string, unknown> = {}
        const req = (id: string) => (id === 'oscillo' ? api : (local[id] ?? (() => { throw new Error(`Cannot import "${id}"`) })()))
        const fn = vm.runInContext(`(async function (require, exports, module) {\n${compile(code, file)}\n})`, context, { filename: file, lineOffset: -1 }) as (r: unknown, e: unknown, m: unknown) => Promise<void>
        await fn(req, exports, { exports })
        exportsOf.set(file, exports)
        return exports
      }
      const timeout = opts.timeout ? new Promise<never>((_, rej) => setTimeout(() => (r.stop(), rej(new Error(`Stopped after the ${opts.timeout} s timeout`))), opts.timeout * 1000)) : null
      await (timeout ? Promise.race([load(entry, []), timeout]) : load(entry, []))
      const files_ = [...wrote].map((p) => p.split('/').pop())
      emit({ type: 'console', kind: 'info', text: `Finished in ${((Date.now() - started) / 1000).toFixed(1)} s${files_.length ? `. Wrote ${files_.join(', ')} to Documents/Oscillo` : ''}` })
      emit({ type: 'done', ok: true })
    } catch (err) {
      if (err instanceof Stop) emit({ type: 'done', ok: false, stopped: true, file: r.at.file, line: r.at.line })
      else {
        const msg = (err as Error)?.message ?? String(err)
        const name = (err as Error)?.name && (err as Error).name !== 'Error' ? `${(err as Error).name}: ` : ''
        emit({ type: 'console', kind: 'err', text: `${name}${msg}${r.at.line ? ` (${r.at.file}:${r.at.line})` : ''}` })
        emit({ type: 'done', ok: false, error: msg, file: r.at.file, line: r.at.line })
      }
    } finally {
      run = null
    }
  })
}
