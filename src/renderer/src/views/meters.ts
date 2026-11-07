// DC / AC RMS / true RMS of the two scope inputs, as the device measured them (see hwsync.ts).
import { useHwLive } from '../hwsync'

export interface Reading {
  dc: number
  ac: number
  rms: number
}

const NONE: Reading = { dc: 0, ac: 0, rms: 0 }

export const readChannel = (i: 0 | 1): Reading => useHwLive.getState().meters?.[i] ?? NONE
