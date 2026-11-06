// Binds the installed WaveForms SDK library with koffi. Every function in dwf.h becomes a method of
// DwfRaw; pointer parameters take typed arrays (or a Buffer for strings) that the SDK writes into.
import { existsSync } from 'node:fs'
import koffiModule from 'koffi'
import { PROTOTYPES, TYPEDEFS, type DwfRaw } from './generated'

/** Where WaveForms installs the SDK library on each platform. */
export function libraryCandidates(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') return ['/Library/Frameworks/dwf.framework/dwf', '/Applications/WaveForms.app/Contents/Frameworks/dwf.framework/dwf']
  if (platform === 'win32') return ['dwf.dll', 'C:\\Windows\\System32\\dwf.dll']
  return ['/usr/lib/libdwf.so', '/usr/lib64/libdwf.so', '/usr/local/lib/libdwf.so', 'libdwf.so']
}

/** The first location that exists, trying `preferred` (e.g. a copy bundled with the app) first; null when there is none. */
export function findLibrary(preferred: string[] = [], platform: NodeJS.Platform = process.platform): string | null {
  for (const p of [...preferred, ...libraryCandidates(platform)]) {
    // Bare names resolve through the system loader, so they count as found only if loading works.
    if (!p.includes('/') && !p.includes('\\')) return tryLoad(p) ? p : null
    if (existsSync(p)) return p
  }
  return null
}

type Koffi = typeof koffiModule
const koffi: Koffi = koffiModule
let aliased = false
function getKoffi(): Koffi {
  if (!aliased) {
    for (const [name, base] of Object.entries(TYPEDEFS)) koffi.alias(name, base)
    aliased = true
  }
  return koffi
}

function tryLoad(path: string): boolean {
  try {
    getKoffi().load(path)
    return true
  } catch {
    return false
  }
}

export class DwfLoadError extends Error {
  constructor(
    message: string,
    readonly tried: string[]
  ) {
    super(message)
    this.name = 'DwfLoadError'
  }
}

/**
 * Loads libdwf and binds every SDK function. Functions missing from an older library throw when
 * called, instead of failing the whole load.
 */
export function loadDwf(path?: string): DwfRaw {
  const k = getKoffi()
  const tried = path ? [path] : libraryCandidates()
  const at = path ?? findLibrary()
  if (!at) throw new DwfLoadError('WaveForms is not installed. Install it from digilent.com to use a real device.', tried)
  let lib: ReturnType<Koffi['load']>
  try {
    lib = k.load(at)
  } catch (e) {
    throw new DwfLoadError(`Could not load ${at}: ${(e as Error).message}`, tried)
  }
  const raw: Record<string, (...args: unknown[]) => number> = {}
  for (const proto of PROTOTYPES) {
    const name = /\s(\w+)\(/.exec(proto)![1]
    try {
      raw[name] = lib.func(proto) as (...args: unknown[]) => number
    } catch {
      raw[name] = () => {
        throw new DwfLoadError(`${name} is not in this version of the WaveForms SDK`, [at])
      }
    }
  }
  return raw as unknown as DwfRaw
}
