// File dialogs and writes, served by the main process (src/main/files.ts).
export interface Filter {
  name: string
  extensions: string[]
}

export const FILES = {
  save: 'files:save',
  open: 'files:open',
  folder: 'files:folder',
  write: 'files:write',
  read: 'files:read',
  reveal: 'files:reveal',
  capture: 'files:capture',
  dataDir: 'files:data-dir',
  version: 'files:version',
  external: 'files:external',
  mkdir: 'files:mkdir',
  release: 'files:release',
  /** Main → renderer: open this workspace file (Finder, the dock or the command line). */
  opened: 'files:opened'
} as const

export interface FilesApi {
  /** Asks where to save, then writes. A string is written as UTF-8. Returns the path, or null when cancelled. */
  save(name: string, data: string | Uint8Array, filters?: Filter[], dir?: string): Promise<string | null>
  /** Asks for a file and returns its text (or bytes with `binary`). */
  open(filters?: Filter[], binary?: boolean): Promise<{ path: string; name: string; text: string; bytes?: Uint8Array } | null>
  /** Asks for a folder. */
  folder(start?: string): Promise<string | null>
  /** Writes (or appends to) a file. `~` is the home folder; missing folders are made. Returns the full path. */
  write(path: string, data: string | Uint8Array, append?: boolean): Promise<string>
  read(path: string): Promise<string>
  mkdir(path: string): Promise<string>
  reveal(path: string): Promise<void>
  /** The window as PNG bytes. */
  capture(): Promise<Uint8Array>
  /** Documents/Oscillo. */
  dataDir(): Promise<string>
  /** App version, Electron version and the executable path. */
  version(): Promise<{ app: string; electron: string; exe: string }>
  external(url: string): Promise<void>
  /** The newest published release on GitHub, or why it could not be checked. */
  release(): Promise<{ tag: string; url: string } | { error: string }>
}
