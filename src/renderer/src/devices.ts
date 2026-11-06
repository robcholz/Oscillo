// Devices come from the main process: whatever the WaveForms SDK finds, plus the simulated Demo
// Device. Connecting opens the device there; instruments then call `hw` (see src/main/hardware.ts).
import { create } from 'zustand'
import type { HwApi, HwStatus, Link } from '../../shared/hw'
import { useStore } from './store'

export type DeviceId = string

export interface DeviceInfo {
  id: DeviceId
  name: string
  /** Serial number, IP address or "Simulated". */
  serial: string
  link: Link
  /** Opened by another program. */
  busy: boolean
}

export const DEMO: DeviceInfo = { id: 'DEMO', name: 'Demo Device', serial: 'Simulated', link: 'SIM', busy: false }

/** The main-process hardware API; null outside Electron (tests). */
export const hw: HwApi | null = typeof window !== 'undefined' ? (window.oscillo?.hw ?? null) : null

interface DevicesState {
  list: DeviceInfo[]
  status: HwStatus | null
  scanning: boolean
}
export const useDevices = create<DevicesState>()(() => ({ list: [DEMO], status: null, scanning: false }))

export const deviceById = (id: DeviceId | null): DeviceInfo | null => (id ? (useDevices.getState().list.find((d) => d.id === id) ?? null) : null)
/** The connected device, kept current as the list refreshes. */
export const useDevice = (): DeviceInfo | null => {
  const id = useStore((s) => s.device)
  return useDevices((d) => (id ? (d.list.find((x) => x.id === id) ?? null) : null))
}
/** True when the connected device is real hardware rather than the Demo Device. */
export const useHardware = (): boolean => {
  const d = useDevice()
  return !!d && d.link !== 'SIM'
}

export async function refreshDevices(): Promise<DeviceInfo[]> {
  if (!hw) return [DEMO]
  useDevices.setState({ scanning: true })
  try {
    const [status, list] = await Promise.all([hw.status(), hw.devices()])
    const mapped = list.map((d) => ({ id: d.key, name: d.name, serial: d.serial, link: d.link, busy: d.busy }))
    useDevices.setState({ list: mapped, status })
    return mapped
  } finally {
    useDevices.setState({ scanning: false })
  }
}

/** Opens a device (or disconnects with null). Reports failures as a toast and returns whether it worked. */
export async function connectDevice(id: DeviceId | null, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const app = useStore.getState()
  try {
    if (!id) {
      await hw?.close()
      app.setDevice(null)
      if (!opts.quiet) app.toast('Device disconnected', { detail: 'Reconnect to resume captures.' })
      return true
    }
    const d = deviceById(id)
    if (d?.busy) throw new Error(`${d.name} is open in another program. Close it there, then connect again.`)
    await hw?.open(id, Number(app.config) || 1)
    app.setDevice(id)
    if (!opts.quiet) app.toast(`Connected to ${d?.name ?? id}`)
    return true
  } catch (e) {
    app.setDevice(null)
    app.toast('Could not connect', { detail: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    return false
  }
}

/** On launch: reconnect the last device if it is still there, else the first real one, else the Demo Device. */
export async function startDevices(): Promise<void> {
  const list = await refreshDevices()
  const last = useStore.getState().device
  const pick = list.find((d) => d.id === last) ?? list.find((d) => d.link !== 'SIM' && !d.busy) ?? (last === null ? null : DEMO)
  if (pick) await connectDevice(pick.id, { quiet: true })
}

/** Buffer configurations: memory split between instruments. */
export const CONFIGS = [
  { value: '1', label: '1 · Balanced', description: 'Scope 32 Ki · Wavegen 16 Ki · Logic 32 Ki', scope: '32 Ki' },
  { value: '2', label: '2 · Scope Heavy', description: 'Scope 64 Ki · Wavegen 4 Ki · Logic 8 Ki', scope: '64 Ki' },
  { value: '3', label: '3 · Wavegen Heavy', description: 'Scope 16 Ki · Wavegen 32 Ki · Logic 16 Ki', scope: '16 Ki' },
  { value: '4', label: '4 · Logic Heavy', description: 'Scope 8 Ki · Wavegen 4 Ki · Logic 64 Ki', scope: '8 Ki' }
] as const
