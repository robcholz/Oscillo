// DC / AC RMS / true RMS of the two scope inputs. Real hardware reports what it measured (see
// hwsync.ts); the Demo Device derives them from the waveform generator (W1 looped to C1, W2 to C2).
import { samples } from '../sim/wave'
import { isHardware, useHwLive } from '../hwsync'
import { useWavegen } from './Wavegen'

export interface Reading {
  dc: number
  ac: number
  rms: number
}

export function readChannel(i: 0 | 1, noise = 0.002): Reading {
  if (isHardware()) return useHwLive.getState().meters?.[i] ?? { dc: 0, ac: 0, rms: 0 }
  const c = useWavegen.getState().ch[i]
  if (!c.run || !c.out) return { dc: rnd(noise), ac: Math.abs(rnd(noise)), rms: Math.abs(rnd(noise)) }
  const { v } = samples(c.type, { freq: c.freq, amp: c.amp, offset: c.offset, sym: c.sym, phase: c.phase, periods: 4, n: 800 })
  let sum = 0
  let sq = 0
  for (const x of v) {
    sum += x
    sq += x * x
  }
  const dc = sum / v.length + rnd(noise)
  const rms = Math.sqrt(sq / v.length) + rnd(noise)
  const ac = Math.sqrt(Math.max(0, rms * rms - dc * dc))
  return { dc, ac, rms }
}

const rnd = (a: number) => (Math.random() - 0.5) * 2 * a
