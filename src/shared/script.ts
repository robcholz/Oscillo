// Script runs in the main process (TypeScript checked and compiled there, run in a VM context);
// the renderer starts, steps and stops it and receives its events.

export interface Problem {
  file: string
  line: number
  col: number
  message: string
  code: number
  /** A replacement that fixes it, when there is an obvious one. */
  fix?: { start: number; end: number; text: string; title: string }
}

export interface ScriptVar {
  n: string
  v: string
  t: string
}

/** Settings a script changed, for the instrument pages to show. */
export type ScriptApply =
  | { kind: 'wavegen'; channel: number; run: boolean; type?: string; freq?: number; amp?: number; offset?: number; sym?: number; phase?: number }
  | { kind: 'supplies'; master: boolean; pos: { on: boolean; volts: number }; neg: { on: boolean; volts: number } }
  | { kind: 'dio'; mask: number; value: number }

export type ScriptEvent =
  | { type: 'console'; text: string; kind: 'out' | 'err' | 'info' }
  | { type: 'paused'; file: string; line: number; vars: ScriptVar[] }
  | { type: 'resumed' }
  | { type: 'done'; ok: boolean; file?: string; line?: number; error?: string; stopped?: boolean }
  | { type: 'apply'; apply: ScriptApply }

export interface RunOptions {
  /** Seconds; 0 = none. */
  timeout: number
  breakpoints: Record<string, number[]>
  /** Allow fetch(). */
  network: boolean
  /** Let File open any path, not only names in Documents/Oscillo. */
  anyPath?: boolean
}

export const SCRIPT = {
  check: 'script:check',
  run: 'script:run',
  resume: 'script:resume',
  stop: 'script:stop',
  breakpoints: 'script:breakpoints',
  event: 'script:event',
  folder: 'script:folder',
  sync: 'script:sync'
} as const

export interface ScriptApi {
  check(files: Record<string, string>, file: string): Promise<Problem[]>
  run(files: Record<string, string>, file: string, opts: RunOptions): Promise<void>
  /** Continue to the next breakpoint, or one step. */
  resume(step: boolean): Promise<void>
  /** abort also resets the outputs to idle. */
  stop(abort: boolean): Promise<void>
  breakpoints(bps: Record<string, number[]>): Promise<void>
  /** Opens the folder scripts write files to. */
  folder(): Promise<string>
  /** Saves the workspace's scripts to Documents/Oscillo/Scripts, for running from a terminal. */
  sync(files: Record<string, string>): Promise<void>
  onEvent(fn: (e: ScriptEvent) => void): () => void
}
