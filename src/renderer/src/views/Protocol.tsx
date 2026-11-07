// Protocol (board: Protocol). A console per bus (UART, SPI, I2C, CAN, CEC, JTAG, SWD, AVR) with a
// compose bar that talks through the device's protocol masters, spy modes, and the per-protocol settings panel.
import { Badge, Button, Description, Input, Note, Progress, Select, StatusDot, Switch, Tabs, Toggle, type StatusDotState } from '@robcholz/geist'
import { CornerDownLeft, Cpu, Eye, FolderOpen, Plug, RefreshCw, Search, Square, SquareTerminal, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Grid2, LabeledInput, LabeledSelect, PageBar, PanelSection, SplitPage } from '../components/Page'
import { useInterval } from '../components/useInterval'
import type { ProtocolCalls } from '../../../shared/hw'
import { hw } from '../devices'
import { files } from '../files'
import { useStore } from '../store'

const TABS = ['UART', 'SPI', 'I2C', 'CAN', 'CEC', 'JTAG', 'SWD', 'AVR'] as const
type Tab = (typeof TABS)[number]
const PINS = Array.from({ length: 16 }, (_, i) => `DIO ${i}`)
const CEC_ADDR = ['0 · TV', '1 · Recorder 1', '3 · Tuner 1', '4 · Playback 1', '5 · Audio System', '8 · Playback 2', '15 · Broadcast']
const CEC_OPS = ['0x04 · Image View On', '0x36 · Standby', '0x44 · User Control Pressed', '0x46 · Give OSD Name', '0x83 · Give Physical Address', '0x8F · Give Power Status', '0x9F · Get CEC Version']
const SWD_REGS = ['0x0 · DPIDR', '0x4 · CTRL/STAT', '0x8 · SELECT', '0xC · RDBUFF']
const AVR_CMDS = ['Read Signature', 'Read Fuses', 'Read Lock Bits', 'Read Flash Word', 'Read EEPROM Byte']
const CHIPS: Record<string, string> = { ATmega328P: '1E 95 0F', ATmega2560: '1E 98 01', ATmega32U4: '1E 95 87', ATtiny85: '1E 93 0B', ATtiny13A: '1E 90 07' }

interface Line {
  t: string
  d: 'TX' | 'RX' | '··'
  x: string
  raw?: string
  r?: 'ACK' | 'NAK' | ''
  err?: boolean
}

const F0 = {
  ts: true, auto: true, draft: '', ending: 'CR LF', uBaud: '115200', uBits: '8', uPar: 'None', uStop: '1', uTx: 'DIO 4', uRx: 'DIO 5', uPol: 'Normal',
  spiMode: 'Master', spiCs: 'DIO 3', spiClk: 'DIO 0', spiMosi: 'DIO 1', spiMiso: 'DIO 2', spiHz: '1', spiCpol: 'Mode 0', spiOrder: 'MSB First', spiLines: 'Standard', spiW: '9F 00 00 00', spiR: '3',
  i2cMode: 'Master', i2cScl: 'DIO 0', i2cSda: 'DIO 1', i2cHz: '100', i2cStretch: true, i2cAddr: '0x48', i2cW: '00', i2cR: '2',
  canTx: 'DIO 6', canRx: 'DIO 7', canRate: '500', canPol: 'Normal', canSpy: false, canId: '0x123', canD: 'DE AD BE EF', canExt: false, canRtr: false,
  cecPin: 'DIO 8', cecOwn: '4 · Playback 1', cecSpy: false, cecTo: '0 · TV', cecOp: '0x04 · Image View On', cecArg: '',
  jTck: 'DIO 0', jTms: 'DIO 1', jTdi: 'DIO 2', jTdo: 'DIO 3', jHz: '1', jEdge: 'Rising', jReg: 'IR', jLen: '6', jVal: '09',
  sClk: 'DIO 0', sIo: 'DIO 1', sRst: 'None', sHz: '1', sTurn: '1', sPort: 'DP', sAddr: '0x0 · DPIDR', sVal: '00000000',
  aChip: 'ATmega328P', aRst: 'DIO 3', aSck: 'DIO 0', aMosi: 'DIO 1', aMiso: 'DIO 2', aHz: '125', aLfuse: 'FF', aHfuse: 'DE', aEfuse: 'FD', aLock: 'FF', aFile: '~/avr/blink.hex', aCmd: 'Read Signature', aAddr: '0000'
}
type Fields = typeof F0

const now = () => {
  const d = new Date()
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}
const bytes = (s: string) => s.trim().split(/[\s,]+/).filter(Boolean)
const isHex = (s: string) => bytes(s).every((b) => /^(0x)?[0-9a-f]{1,2}$/i.test(b))
const hexOf = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(' ')

const FAIL = Symbol('failed')
let memo: { logs: Record<Tab, Line[]>; f: Fields; tab: Tab } | null = null

export function Protocol() {
  const app = useStore()
  const toast = app.toast
  const [tab, setTab] = useState<Tab>(memo?.tab ?? 'UART')
  const [f, setF] = useState<Fields>(memo?.f ?? F0)
  const [logs, setLogs] = useState<Record<Tab, Line[]>>(memo?.logs ?? { UART: [], SPI: [], I2C: [], CAN: [], CEC: [], JTAG: [], SWD: [], AVR: [] })
  const [open, setOpen] = useState(true)
  const [views, setViews] = useState<Record<string, string>>({})
  const [chain, setChain] = useState<string[][] | null>(null)
  const [swd, setSwd] = useState(false)
  const [avr, setAvr] = useState(false)
  const [pct, setPct] = useState(0)
  const [busy, setBusy] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const isU = tab === 'UART'
  const set = <K extends keyof Fields>(k: K) => (v: Fields[K]) => setF((x) => ({ ...x, [k]: v }))
  const view = views[tab] ?? (isU ? 'ASCII' : 'Decoded')
  const spy: Partial<Record<Tab, boolean>> = { SPI: f.spiMode === 'Spy', I2C: f.i2cMode === 'Spy', CAN: f.canSpy, CEC: f.cecSpy }

  useEffect(() => {
    memo = { logs, f, tab }
  }, [logs, f, tab])
  useEffect(() => {
    if (f.auto && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs, tab, f.auto])

  const push = (T: Tab, lines: Omit<Line, 't'>[]) => setLogs((l) => ({ ...l, [T]: [...l[T], ...lines.map((x) => ({ t: now(), ...x }))].slice(-500) }))
  const need = (ok: boolean, title: string, detail: string) => {
    if (!ok) toast(title, { detail })
    return ok
  }
  const device = () => need(!!app.device, 'No device connected', 'Connect a device, then try again.')

  // Every action goes through the device's protocol masters.
  const pin = (p: string) => Number(/\d+/.exec(p)?.[0] ?? 0)
  const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
  /** Calls the device; on failure logs the error to the console and returns FAIL. */
  const call = async <K extends keyof ProtocolCalls>(T: Tab, name: K, ...args: Parameters<ProtocolCalls[K]>): Promise<ReturnType<ProtocolCalls[K]> | typeof FAIL> => {
    try {
      return await hw!.protocol(name, ...args)
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      push(T, [{ d: '··', x: msg, err: true }])
      return FAIL
    }
  }
  const spiCfg = () => ({ sck: pin(f.spiClk), mosi: pin(f.spiMosi), miso: pin(f.spiMiso), cs: pin(f.spiCs), frequency: (Number(f.spiHz) || 1) * 1e6, mode: Number(f.spiCpol.slice(-1)) || 0, msbFirst: f.spiOrder !== 'LSB First' })
  const uartSetup = () => call('UART', 'uartSetup', { tx: pin(f.uTx), rx: pin(f.uRx), baud: Number(f.uBaud) || 9600, bits: Number(f.uBits) || 8, parity: f.uPar === 'Odd' ? 1 : f.uPar === 'Even' ? 2 : 0, stop: Number(f.uStop) || 1 })
  const rxText = useRef('')
  // UART receive and CAN spy poll the device while open.
  useInterval(async () => {
    if (isU && open) {
      const r = await call('UART', 'uartReceive')
      if (r === FAIL || !r.data.length) return
      rxText.current += String.fromCharCode(...r.data)
      const parts = rxText.current.split(/\r?\n/)
      rxText.current = parts.pop() ?? ''
      if (parts.length) push('UART', parts.map((x) => ({ d: 'RX' as const, x, raw: hexOf(x), err: r.parityError })))
    }
    if (tab === 'CAN' && f.canSpy) {
      for (let i = 0; i < 16; i++) {
        const fr = await call('CAN', 'canReceive')
        if (fr === FAIL || !fr) break
        const d = fr.data.map(hex2).join(' ')
        push('CAN', [{ d: 'RX', x: `ID 0x${fr.id.toString(16).toUpperCase()} · DLC ${fr.data.length}${fr.remote ? ' · Remote' : ''} · ${d}`, raw: `${fr.id.toString(16).toUpperCase()} ${fr.extended ? 1 : 0} ${fr.data.length} ${d}`, r: 'ACK' }])
      }
    }
  }, 150, !!app.device && ((isU && open) || (tab === 'CAN' && f.canSpy)))
  useEffect(() => {
    if (open && app.device) void uartSetup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, app.device, f.uBaud, f.uBits, f.uPar, f.uStop, f.uTx, f.uRx])
  useEffect(() => {
    if (f.canSpy && app.device) void call('CAN', 'canSetup', { tx: pin(f.canTx), rx: pin(f.canRx), rate: (Number(f.canRate) || 500) * 1e3 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.canSpy, app.device, f.canTx, f.canRx, f.canRate])

  const act = {
    uart: async () => {
      if (!device() || !need(open, 'Port is closed', 'Open the port, then send again.') || !f.draft) return
      const end = f.ending === 'CR LF' ? '\r\n' : f.ending === 'LF' ? '\n' : f.ending === 'CR' ? '\r' : ''
      const text = f.draft + end
      setF((x) => ({ ...x, draft: '' }))
      if ((await call('UART', 'uartSend', [...text].map((c) => c.charCodeAt(0) & 0xff))) !== FAIL) push('UART', [{ d: 'TX', x: f.draft, raw: hexOf(text) }])
    },
    spi: async () => {
      if (!device()) return
      if (f.spiMode === 'Spy') return toast('Spy runs in the Logic Analyzer', { detail: 'Add an SPI interpreter there to watch the bus without driving it.' })
      if (!need(isHex(f.spiW), 'Write bytes are not hex', 'Use bytes like 9F 00 00 00.')) return
      const w = bytes(f.spiW).map((b) => parseInt(b.replace(/^0x/i, ''), 16))
      const n = Math.max(0, Math.min(256, Number(f.spiR) || 0))
      if ((await call('SPI', 'spiSetup', spiCfg())) === FAIL) return
      const r = await call('SPI', 'spiTransfer', [...w, ...Array(n).fill(0)])
      if (r === FAIL) return
      const read = r.slice(w.length).map(hex2).join(' ')
      push('SPI', [{ d: 'TX', x: 'Write ' + w.map(hex2).join(' '), raw: 'CS↓  ' + w.map(hex2).join(' ') }, ...(n ? [{ d: 'RX' as const, x: 'Read ' + read, raw: r.map(hex2).join(' ') + '  CS↑' }] : [])])
    },
    i2c: async (read: boolean) => {
      if (!device()) return
      if (f.i2cMode === 'Spy') return toast('Spy runs in the Logic Analyzer', { detail: 'Add an I²C interpreter there to watch the bus without driving it.' })
      const a = parseInt(f.i2cAddr, 16)
      if (!need(a >= 0x08 && a <= 0x77, 'Address out of range', 'Use a 7-bit address from 0x08 to 0x77.')) return
      if (!need(isHex(f.i2cW), 'Write bytes are not hex', 'Use bytes like 01 60.')) return
      if ((await call('I2C', 'i2cSetup', { scl: pin(f.i2cScl), sda: pin(f.i2cSda), rate: (Number(f.i2cHz) || 100) * 1e3 })) === FAIL) return
      const w = bytes(f.i2cW).map((b) => parseInt(b.replace(/^0x/i, ''), 16))
      const n = read ? Math.max(1, Math.min(32, Number(f.i2cR) || 1)) : 0
      const r = await call('I2C', 'i2cTransfer', a, w, n)
      if (r === FAIL) return
      const addr = '0x' + hex2(a)
      const ack = r.nak === 0
      push('I2C', [
        { d: 'TX', x: `Write ${addr}: ${w.map(hex2).join(' ')}`, raw: `S ${hex2(a << 1)} ${ack ? 'A' : 'N'} ${w.map(hex2).join(' A ')} P`, r: ack ? 'ACK' : 'NAK' },
        ...(read && ack ? [{ d: 'RX' as const, x: `Read ${addr}: ${r.data.map(hex2).join(' ')}`, raw: `Sr ${hex2((a << 1) | 1)} A ${r.data.map(hex2).join(' ')} N P`, r: 'ACK' as const }] : [])
      ])
    },
    scan: async () => {
      if (!device()) return
      push('I2C', [{ d: '··', x: 'Scanning 0x08 to 0x77…' }])
      setBusy('Scanning')
      try {
        if ((await call('I2C', 'i2cSetup', { scl: pin(f.i2cScl), sda: pin(f.i2cSda), rate: (Number(f.i2cHz) || 100) * 1e3 })) === FAIL) return
        const found: string[] = []
        for (let a = 0x08; a <= 0x77; a++) {
          const r = await call('I2C', 'i2cTransfer', a, [], 0)
          if (r !== FAIL && r.nak === 0) found.push('0x' + hex2(a))
        }
        push('I2C', [{ d: 'RX', x: found.length ? `Found ${found.length} device${found.length > 1 ? 's' : ''}: ${found.join(', ')}` : 'No devices answered', r: found.length ? 'ACK' : 'NAK' }])
      } finally {
        setBusy('')
      }
    },
    can: async () => {
      if (!device()) return
      const d = bytes(f.canD)
      if (!need(isHex(f.canD) && d.length <= 8, 'Data is not valid', 'Use up to 8 hex bytes, like DE AD BE EF.')) return
      const id = parseInt(f.canId, 16)
      if ((await call('CAN', 'canSetup', { tx: pin(f.canTx), rx: pin(f.canRx), rate: (Number(f.canRate) || 500) * 1e3 })) === FAIL) return
      const data = d.map((b) => parseInt(b.replace(/^0x/i, ''), 16))
      if ((await call('CAN', 'canSend', { id, extended: f.canExt, remote: f.canRtr, data })) === FAIL) return
      push('CAN', [{ d: 'TX', x: `ID 0x${id.toString(16).toUpperCase()} · DLC ${data.length}${f.canRtr ? ' · Remote' : ''} · ${data.map(hex2).join(' ')}`, raw: `${id.toString(16).toUpperCase()} ${f.canExt ? 1 : 0} ${data.length} ${data.map(hex2).join(' ')}` }])
    },
    cec: () => toast('CEC is not available on this device yet', { detail: 'CEC needs precise timing on a single pin, which the device cannot drive from this app yet.' }),
    cecPoll: () => toast('CEC is not available on this device yet', { detail: 'CEC needs precise timing on a single pin, which the device cannot drive from this app yet.' }),
    jScan: async () => {
      if (!device()) return
      setBusy('Scanning Chain')
      try {
        await call('JTAG', 'jtagSetup', { tck: pin(f.jTck), tms: pin(f.jTms), tdi: pin(f.jTdi), tdo: pin(f.jTdo) })
        const ids = await call('JTAG', 'jtagScan')
        if (ids === FAIL) return
        const c = ids.map((id) => ['0x' + id.toString(16).toUpperCase().padStart(8, '0'), id ? 'IDCODE' : 'Bypass only', '?'])
        setChain(c)
        push('JTAG', [{ d: '··', x: ids.length ? `Chain scanned: ${ids.length} device${ids.length > 1 ? 's' : ''}` : 'No devices found. Check TCK, TMS, TDI, TDO and power.' }, ...c.map((d, i) => ({ d: 'RX' as const, x: `Device ${i}: IDCODE ${d[0]}`, raw: `DR 32 bits: ${d[0]}` }))])
      } finally {
        setBusy('')
      }
    },
    jShift: async () => {
      if (!device()) return
      if (!need(/^[0-9a-f]+$/i.test(f.jVal), 'Value is not hex', 'Use a hex value like 09.')) return
      await call('JTAG', 'jtagSetup', { tck: pin(f.jTck), tms: pin(f.jTms), tdi: pin(f.jTdi), tdo: pin(f.jTdo) })
      const len = Math.max(1, Math.min(1024, Number(f.jLen) || 1))
      const out = await call('JTAG', 'jtagShift', f.jReg as 'IR' | 'DR', len, f.jVal)
      if (out === FAIL) return
      push('JTAG', [{ d: 'TX', x: `Shift ${f.jReg} ${len} bits: 0x${f.jVal.toUpperCase()}` }, { d: 'RX', x: `TDO 0x${out}`, raw: `TDO ${BigInt('0x' + out).toString(2).padStart(len, '0')}` }])
    },
    jReset: async () => {
      if (!device()) return
      await call('JTAG', 'jtagSetup', { tck: pin(f.jTck), tms: pin(f.jTms), tdi: pin(f.jTdi), tdo: pin(f.jTdo) })
      if ((await call('JTAG', 'jtagReset')) !== FAIL) push('JTAG', [{ d: '··', x: 'TAP reset: TMS high for 6 clocks, now Run-Test/Idle' }])
    },
    sConnect: async () => {
      if (!device()) return
      if (swd) {
        setSwd(false)
        return push('SWD', [{ d: '··', x: 'Disconnected' }])
      }
      await call('SWD', 'swdSetup', { clk: pin(f.sClk), io: pin(f.sIo) })
      const id = await call('SWD', 'swdConnect')
      if (id === FAIL) return
      setSwd(true)
      push('SWD', [{ d: '··', x: 'Line reset and JTAG-to-SWD sequence sent' }, { d: 'RX', x: `DPIDR 0x${id.toString(16).toUpperCase().padStart(8, '0')}`, raw: `OK ${id.toString(16).toUpperCase()}`, r: 'ACK' }])
    },
    sRead: async () => {
      if (!device() || !need(swd, 'Not connected', 'Press Connect to read the Debug Port ID first.')) return
      const v = await call('SWD', 'swdTransfer', f.sPort === 'AP', true, parseInt(f.sAddr, 16))
      if (v === FAIL) return
      const h = v.toString(16).toUpperCase().padStart(8, '0')
      push('SWD', [{ d: 'RX', x: `Read ${f.sPort} ${f.sAddr}: 0x${h}`, raw: `OK ${h}`, r: 'ACK' }])
    },
    sWrite: async () => {
      if (!device() || !need(swd, 'Not connected', 'Press Connect to read the Debug Port ID first.')) return
      if (!need(/^[0-9a-f]{1,8}$/i.test(f.sVal), 'Value is not valid', 'Use up to 8 hex digits.')) return
      if ((await call('SWD', 'swdTransfer', f.sPort === 'AP', false, parseInt(f.sAddr, 16), parseInt(f.sVal, 16))) === FAIL) return
      push('SWD', [{ d: 'TX', x: `Write ${f.sPort} ${f.sAddr}: 0x${f.sVal.toUpperCase().padStart(8, '0')}`, raw: `OK ${f.sVal.toUpperCase()}`, r: 'ACK' }])
    },
    aSig: async () => {
      if (!device()) return
      const sig = await call('AVR', 'avrEnter', { sck: pin(f.aSck), mosi: pin(f.aMosi), miso: pin(f.aMiso), cs: pin(f.aRst), frequency: (Number(f.aHz) || 125) * 1e3, mode: 0 })
      if (sig === FAIL) return
      const s = sig.map(hex2).join(' ')
      const chip = Object.entries(CHIPS).find(([, v]) => v === s)?.[0]
      setAvr(true)
      push('AVR', [{ d: '··', x: 'Programming Enable: AC 53 00 00 → 53 echoed' }, { d: 'RX', x: `Signature ${s} · ${chip ?? 'Unknown chip'}`, err: chip !== f.aChip }])
      if (chip && chip !== f.aChip) toast(`This is an ${chip}`, { detail: `The chip setting says ${f.aChip}. Change it before programming.` })
    },
    aRun: async () => {
      if (!device() || !need(avr, 'Not in programming mode', 'Press Read Signature first.')) return
      const addr = parseInt(f.aAddr, 16) || 0
      let out = ''
      if (f.aCmd === 'Read Signature') {
        const sig = await call('AVR', 'avrEnter', { sck: pin(f.aSck), mosi: pin(f.aMosi), miso: pin(f.aMiso), cs: pin(f.aRst), frequency: (Number(f.aHz) || 125) * 1e3, mode: 0 })
        if (sig !== FAIL) out = sig.map(hex2).join(' ')
      } else if (f.aCmd === 'Read Fuses' || f.aCmd === 'Read Lock Bits') {
        const fu = await call('AVR', 'avrFuses')
        if (fu !== FAIL) out = f.aCmd === 'Read Fuses' ? `Low ${hex2(fu.low)} · High ${hex2(fu.high)} · Extended ${hex2(fu.ext)}` : hex2(fu.lock)
      } else if (f.aCmd === 'Read Flash Word') {
        const w = await call('AVR', 'avrReadFlashWord', addr)
        if (w !== FAIL) out = `0x${f.aAddr}: ${w.map(hex2).join(' ')}`
      } else {
        const b = await call('AVR', 'avrReadEeprom', addr)
        if (b !== FAIL) out = `0x${f.aAddr}: ${hex2(b)}`
      }
      if (out) push('AVR', [{ d: 'RX', x: `${f.aCmd} · ${out}` }])
    },
    aFuseW: async () => {
      if (!device() || !need(avr, 'Not in programming mode', 'Press Read Signature first.')) return
      if (!need([f.aLfuse, f.aHfuse, f.aEfuse, f.aLock].every((x) => /^[0-9a-f]{2}$/i.test(x)), 'Fuse values are not valid', 'Use two hex digits for each fuse, like DE.')) return
      const v = { low: parseInt(f.aLfuse, 16), high: parseInt(f.aHfuse, 16), ext: parseInt(f.aEfuse, 16), lock: parseInt(f.aLock, 16) }
      if ((await call('AVR', 'avrWriteFuses', v)) === FAIL) return
      push('AVR', [{ d: 'TX', x: `Wrote fuses Low ${f.aLfuse} · High ${f.aHfuse} · Extended ${f.aEfuse} · Lock ${f.aLock}` }])
    },
    aProg: async (verb: 'Program' | 'Verify' | 'Erase') => {
      if (!device() || !need(avr, 'Not in programming mode', 'Press Read Signature first.')) return
      setBusy(verb === 'Program' ? 'Programming' : verb === 'Verify' ? 'Verifying' : 'Erasing')
      setPct(50)
      try {
        if (verb === 'Erase') {
          if ((await call('AVR', 'avrErase')) === FAIL) return
          push('AVR', [{ d: '··', x: 'Chip erased' }])
        } else {
          const n = await call('AVR', verb === 'Program' ? 'avrProgram' : 'avrVerify', f.aFile, f.aChip)
          if (n !== FAIL) push('AVR', [{ d: '··', x: verb === 'Program' ? `Programmed ${f.aFile}: ${n} bytes, verified` : `Flash matches the file: ${n} bytes` }])
        }
      } finally {
        setPct(100)
        setBusy('')
      }
    }
  }
  const A = act

  const topBtn: { text: string; icon: ReactNode; onClick: () => void } = isU
    ? { text: open ? 'Close Port' : 'Open Port', icon: open ? <X size={16} /> : <Plug size={16} />, onClick: () => { setOpen(!open); push('UART', [{ d: '··', x: !open ? `Port opened at ${f.uBaud} bit/s` : 'Port closed' }]) } }
    : spy[tab] !== undefined
      ? {
          text: spy[tab] ? 'Stop Spy' : 'Start Spy',
          icon: spy[tab] ? <Square size={16} /> : <Eye size={16} />,
          onClick: () => {
            if (tab !== 'CAN') return toast(tab === 'CEC' ? 'CEC is not available on this device yet' : 'Spy runs in the Logic Analyzer', { detail: tab === 'CEC' ? 'CEC needs precise timing on a single pin.' : `Add an ${tab} interpreter there to watch the bus without driving it.` })
            const on = !spy[tab]
            setF((x) => ({ ...x, canSpy: on }))
            push(tab, [{ d: '··', x: on ? 'Spying: listening without driving the bus' : 'Spy stopped' }])
          }
        }
      : tab === 'JTAG'
        ? { text: 'Scan Chain', icon: <Search size={16} />, onClick: A.jScan }
        : tab === 'SWD'
          ? { text: swd ? 'Disconnect' : 'Connect', icon: swd ? <X size={16} /> : <Plug size={16} />, onClick: A.sConnect }
          : { text: 'Read Signature', icon: <Cpu size={16} />, onClick: A.aSig }

  const stat: { state: StatusDotState; label: string } = busy
    ? { state: 'BUILDING', label: busy }
    : isU
      ? { state: open ? 'READY' : 'QUEUED', label: open ? 'UART Open' : 'UART Closed' }
      : spy[tab]
        ? { state: 'BUILDING', label: `${tab} Spying` }
        : tab === 'SWD'
          ? { state: swd ? 'READY' : 'QUEUED', label: swd ? 'SWD Connected' : 'SWD Not Connected' }
          : tab === 'AVR'
            ? { state: avr ? 'READY' : 'QUEUED', label: avr ? 'AVR in Programming Mode' : 'AVR Idle' }
            : { state: 'READY', label: `${tab} Ready` }

  const L = logs[tab]
  const txB = L.filter((l) => l.d === 'TX').reduce((n, l) => n + (isU ? l.x.length + 2 : bytes(l.raw ?? l.x).length), 0)
  const rxB = L.filter((l) => l.d === 'RX').reduce((n, l) => n + (isU ? l.x.length + 2 : bytes(l.raw ?? l.x).length), 0)
  const emptyText = isU
    ? open
      ? 'Console cleared. Sent and received data appears here.'
      : 'Open the port to send and receive data.'
    : spy[tab]
      ? 'Spying. Traffic on the bus appears here.'
      : ({ JTAG: 'Scan the chain to list every device, then shift IR and DR.', SWD: 'Connect to read the Debug Port ID, then read or write registers.', AVR: 'Read the signature to put the chip in programming mode.' } as Partial<Record<Tab, string>>)[tab] ?? 'Sent and received frames appear here.'

  const info =
    tab === 'JTAG'
      ? chain
        ? chain.map((c, i) => ({ k: `Device ${i}`, v: `${c[0]} · ${c[1]} · IR ${c[2]}`, mono: false }))
        : [{ k: 'Chain', v: 'Not scanned', mono: false }]
      : tab === 'SWD'
        ? [
            { k: 'DPIDR', v: swd ? '0x2BA01477' : '—', mono: true },
            { k: 'Target', v: swd ? 'Cortex-M4, STM32F411' : 'Not connected', mono: false }
          ]
        : tab === 'AVR'
          ? [
              { k: 'Chip', v: f.aChip, mono: false },
              { k: 'Signature', v: avr ? CHIPS[f.aChip] : '—', mono: true }
            ]
          : []

  const enter = (fn: () => void) => (e: React.KeyboardEvent) => e.key === 'Enter' && fn()
  const mono = 'font-mono'
  const inp = (k: keyof Fields, label: string, placeholder: string, on?: () => void, extra?: { suffix?: string; mono?: boolean }) => (
    <Input
      size="small"
      aria-label={label}
      placeholder={placeholder}
      value={String(f[k])}
      onChange={(e) => set(k)(e.target.value as never)}
      onKeyDown={on ? enter(on) : undefined}
      className={extra?.mono === false ? undefined : mono}
      suffix={extra?.suffix ? <span className="text-[13px] text-gray-700">{extra.suffix}</span> : undefined}
    />
  )
  const sel = (k: keyof Fields, label: string, options: readonly string[]) => <Select size="small" aria-label={label} value={String(f[k])} options={options} onValueChange={(v) => set(k)(v as never)} />
  const sendBtn = (text: string, onClick: () => void) => (
    <Button size="small" suffix={<CornerDownLeft size={16} />} onClick={onClick}>
      {text}
    </Button>
  )

  const compose: Partial<Record<Tab, ReactNode>> = {
    UART: (
      <>
        <div className="min-w-0 flex-1">{inp('draft', 'Data to send', 'Type a message and press Enter', A.uart)}</div>
        <div className="w-[104px]">{sel('ending', 'Line Ending', ['CR LF', 'LF', 'None'])}</div>
        {sendBtn('Send', A.uart)}
      </>
    ),
    SPI: (
      <>
        <div className="min-w-0 flex-1">{inp('spiW', 'Write Bytes', 'Hex bytes to write, like 9F 00 00 00', A.spi)}</div>
        <div className="w-24">{inp('spiR', 'Read Count', 'Read Count', A.spi, { suffix: 'B', mono: false })}</div>
        {sendBtn('Transfer', A.spi)}
      </>
    ),
    I2C: (
      <>
        <div className="w-[88px]">{inp('i2cAddr', 'Address', '0x48')}</div>
        <div className="min-w-0 flex-1">{inp('i2cW', 'Write Bytes', 'Hex bytes, like 01 60', () => A.i2c(true))}</div>
        <div className="w-24">{inp('i2cR', 'Read Count', 'Read Count', undefined, { suffix: 'B', mono: false })}</div>
        <Button size="small" type="tertiary" prefix={<Search size={16} />} onClick={A.scan}>
          Scan
        </Button>
        <Button size="small" type="secondary" onClick={() => A.i2c(false)}>
          Write
        </Button>
        {sendBtn('Write and Read', () => A.i2c(true))}
      </>
    ),
    CAN: (
      <>
        <div className="w-28">{inp('canId', 'ID', '0x123')}</div>
        <div className="min-w-0 flex-1">{inp('canD', 'Data', 'Up to 8 hex bytes', A.can)}</div>
        {sendBtn('Send Frame', A.can)}
      </>
    ),
    CEC: (
      <>
        <div className="w-40">{sel('cecTo', 'Destination', CEC_ADDR)}</div>
        <div className="w-60">{sel('cecOp', 'Opcode', CEC_OPS)}</div>
        <div className="min-w-0 flex-1">{inp('cecArg', 'Operands', 'Operands, like 41', A.cec)}</div>
        <Button size="small" type="tertiary" prefix={<Search size={16} />} onClick={A.cecPoll}>
          Poll
        </Button>
        {sendBtn('Send', A.cec)}
      </>
    ),
    JTAG: (
      <>
        <Switch aria-label="Register" value={f.jReg} options={['IR', 'DR']} onChange={set('jReg')} />
        <div className="w-[104px]">{inp('jLen', 'Length', 'Length', undefined, { suffix: 'bits', mono: false })}</div>
        <div className="min-w-0 flex-1">{inp('jVal', 'Value', 'Hex value', A.jShift)}</div>
        <Button size="small" type="tertiary" prefix={<RefreshCw size={16} />} onClick={A.jReset}>
          Reset TAP
        </Button>
        {sendBtn('Shift', A.jShift)}
      </>
    ),
    SWD: (
      <>
        <Switch aria-label="Port" value={f.sPort} options={['DP', 'AP']} onChange={set('sPort')} />
        <div className="w-[200px]">{sel('sAddr', 'Register', SWD_REGS)}</div>
        <div className="min-w-0 flex-1">{inp('sVal', 'Value', '32-bit hex value', A.sWrite)}</div>
        <Button size="small" type="secondary" onClick={A.sRead}>
          Read
        </Button>
        {sendBtn('Write', A.sWrite)}
      </>
    ),
    AVR: (
      <>
        <div className="w-60">{sel('aCmd', 'Command', AVR_CMDS)}</div>
        <div className="min-w-0 flex-1">{inp('aAddr', 'Address', 'Hex address', A.aRun)}</div>
        {sendBtn('Run', A.aRun)}
      </>
    )
  }

  const ls = (k: keyof Fields, label: string, options: readonly string[]) => <LabeledSelect label={label} value={String(f[k])} options={options} onValueChange={(v) => set(k)(v as never)} />
  const li = (k: keyof Fields, label: string, suffix?: string, isMono?: boolean) => <LabeledInput label={label} value={String(f[k])} suffix={suffix} className={isMono ? mono : undefined} onChange={(e) => set(k)(e.target.value as never)} />
  const tg = (k: keyof Fields, label: string) => (
    <Toggle checked={!!f[k]} onChange={(v) => set(k)(v as never)}>
      {label}
    </Toggle>
  )
  const modeSwitch = (k: 'spiMode' | 'i2cMode') => (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] leading-4 text-gray-900">Mode</span>
      <Switch aria-label="Mode" value={f[k]} options={['Spy', 'Master']} onChange={set(k)} />
    </div>
  )

  const panels: Record<Tab, ReactNode> = {
    UART: (
      <PanelSection title="Port">
        <Grid2>
          {li('uBaud', 'Baud Rate', 'bit/s')}
          {ls('uBits', 'Data Bits', ['8', '7', '6', '5'])}
          {ls('uPar', 'Parity', ['None', 'Even', 'Odd', 'Mark', 'Space'])}
          {ls('uStop', 'Stop Bits', ['1', '1.5', '2'])}
          {ls('uTx', 'TX Pin', PINS)}
          {ls('uRx', 'RX Pin', PINS)}
          {ls('uPol', 'Polarity', ['Normal', 'Inverted'])}
        </Grid2>
      </PanelSection>
    ),
    SPI: (
      <>
        <PanelSection title="Bus">
          {modeSwitch('spiMode')}
          <Grid2>
            {ls('spiCs', 'Select', PINS)}
            {ls('spiClk', 'Clock', PINS)}
            {ls('spiMosi', 'Data 0 (MOSI)', PINS)}
            {ls('spiMiso', 'Data 1 (MISO)', PINS)}
          </Grid2>
        </PanelSection>
        <PanelSection title="Timing">
          <Grid2>
            {li('spiHz', 'Frequency', 'MHz')}
            {ls('spiCpol', 'SPI Mode', ['Mode 0', 'Mode 1', 'Mode 2', 'Mode 3'])}
            {ls('spiOrder', 'Bit Order', ['MSB First', 'LSB First'])}
            {ls('spiLines', 'Data Lines', ['Standard', 'Three-Wire', 'Dual', 'Quad'])}
          </Grid2>
        </PanelSection>
      </>
    ),
    I2C: (
      <PanelSection title="Bus">
        {modeSwitch('i2cMode')}
        <Grid2>
          {ls('i2cScl', 'SCL', PINS)}
          {ls('i2cSda', 'SDA', PINS)}
          {li('i2cHz', 'Rate', 'kHz')}
        </Grid2>
        {tg('i2cStretch', 'Clock Stretching')}
      </PanelSection>
    ),
    CAN: (
      <>
        <PanelSection title="Bus">
          <Grid2>
            {ls('canTx', 'TX', PINS)}
            {ls('canRx', 'RX', PINS)}
            {li('canRate', 'Rate', 'kbit/s')}
            {ls('canPol', 'Polarity', ['Normal', 'Inverted'])}
          </Grid2>
          {tg('canSpy', 'Spy on Bus')}
        </PanelSection>
        <PanelSection title="Frame">
          {tg('canExt', 'Extended ID')}
          {tg('canRtr', 'Remote Frame')}
        </PanelSection>
      </>
    ),
    CEC: (
      <PanelSection title="Bus">
        <Grid2>
          {ls('cecPin', 'CEC Pin', PINS)}
          {ls('cecOwn', 'Own Address', CEC_ADDR)}
        </Grid2>
        {tg('cecSpy', 'Spy on Bus')}
        <Note type="secondary" size="small">
          CEC is a single open-drain line. Use a level shifter for the 3.3 V HDMI CEC pin.
        </Note>
      </PanelSection>
    ),
    JTAG: (
      <>
        <PanelSection title="Pins">
          <Grid2>
            {ls('jTck', 'TCK', PINS)}
            {ls('jTms', 'TMS', PINS)}
            {ls('jTdi', 'TDI', PINS)}
            {ls('jTdo', 'TDO', PINS)}
          </Grid2>
        </PanelSection>
        <PanelSection title="Timing">
          <Grid2>
            {li('jHz', 'Frequency', 'MHz')}
            {ls('jEdge', 'TDO Sample', ['Rising', 'Falling'])}
          </Grid2>
        </PanelSection>
      </>
    ),
    SWD: (
      <>
        <PanelSection title="Pins">
          <Grid2>
            {ls('sClk', 'SWCLK', PINS)}
            {ls('sIo', 'SWDIO', PINS)}
            {ls('sRst', 'nRESET', ['None', ...PINS])}
          </Grid2>
        </PanelSection>
        <PanelSection title="Timing">
          <Grid2>
            {li('sHz', 'Frequency', 'MHz')}
            {li('sTurn', 'Turnaround', 'cycles')}
          </Grid2>
        </PanelSection>
      </>
    ),
    AVR: (
      <>
        <PanelSection title="Chip">
          {ls('aChip', 'Chip', Object.keys(CHIPS))}
          <Grid2>
            {ls('aRst', 'RESET', PINS)}
            {ls('aSck', 'SCK', PINS)}
            {ls('aMosi', 'MOSI', PINS)}
            {ls('aMiso', 'MISO', PINS)}
            {li('aHz', 'SCK Frequency', 'kHz')}
          </Grid2>
        </PanelSection>
        <PanelSection title="Fuses">
          <Grid2>
            {li('aLfuse', 'Low', undefined, true)}
            {li('aHfuse', 'High', undefined, true)}
            {li('aEfuse', 'Extended', undefined, true)}
            {li('aLock', 'Lock', undefined, true)}
          </Grid2>
          <div className="flex gap-2">
            <Button size="small" type="secondary" onClick={() => { if (device() && need(avr, 'Not in programming mode', 'Press Read Signature first.')) push('AVR', [{ d: 'RX', x: `Fuses Low ${f.aLfuse} · High ${f.aHfuse} · Extended ${f.aEfuse} · Lock ${f.aLock}` }]) }}>
              Read
            </Button>
            <Button size="small" type="secondary" onClick={A.aFuseW}>
              Write Fuses
            </Button>
          </div>
        </PanelSection>
        <PanelSection title="Flash">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">{inp('aFile', 'HEX File', 'HEX file')}</div>
            <Button size="small" type="secondary" prefix={<FolderOpen size={16} />} onClick={async () => {
              const r = await files?.open([{ name: 'Intel HEX', extensions: ['hex', 'ihex'] }])
              if (r) setF((x) => ({ ...x, aFile: r.path }))
            }}>
              Browse
            </Button>
          </div>
          <Progress value={pct} aria-label="Flash progress" />
          <div className="flex flex-wrap gap-2">
            <Button size="small" prefix={<Upload size={16} />} disabled={!!busy} onClick={() => A.aProg('Program')}>
              Program
            </Button>
            <Button size="small" type="secondary" disabled={!!busy} onClick={() => A.aProg('Verify')}>
              Verify
            </Button>
            <Button size="small" type="tertiary" prefix={<Trash2 size={16} />} disabled={!!busy} onClick={() => A.aProg('Erase')}>
              Erase Chip
            </Button>
          </div>
        </PanelSection>
      </>
    )
  }

  const panel = (
    <>
      {panels[tab]}
      <div className="p-4">
        <Note type="secondary" size="small">
          Protocol sends with Patterns and receives with Logic. Those instruments show Busy while it runs.
        </Note>
      </div>
    </>
  )

  const shown = (l: Line) => {
    if (isU) return view === 'Hex' && l.d !== '··' ? hexOf(l.x) : l.x
    return view === 'Raw' && l.raw ? l.raw : l.x
  }

  return (
    <SplitPage
      bar={
        <PageBar title="Protocol" status={<StatusDot state={stat.state} label={stat.label} />}>
          <Button size="small" type="secondary" prefix={topBtn.icon} onClick={topBtn.onClick}>
            {topBtn.text}
          </Button>
        </PageBar>
      }
      panelId="protocol"
      panel={panel}
    >
      <Tabs tabs={TABS.map((t) => ({ title: t, value: t }))} selected={tab} setSelected={(v) => setTab(v as Tab)} />
      <div role="group" aria-label={`${tab} console`} className="flex min-h-[320px] flex-[1_1_auto]! flex-col overflow-hidden rounded-medium bg-background-100 shadow-[0_0_0_1px_var(--gray-alpha-400)]">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-background-200 py-2 pl-3 pr-2 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]">
          <div className="flex flex-wrap items-center gap-4">
            <Switch aria-label="Display" value={view} options={isU ? ['ASCII', 'Hex'] : ['Decoded', 'Raw']} onChange={(v) => setViews({ ...views, [tab]: v })} />
            {tg('ts', 'Timestamps')}
            {tg('auto', 'Auto-Scroll')}
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-gray-900">
              <span className="text-[var(--wf-c1)]">TX</span> {txB} B<span className="mx-1 h-3 w-px bg-gray-alpha-400" />
              <span className="text-[var(--wf-c2)]">RX</span> {rxB} B
            </span>
            <Button type="tertiary" size="small" svgOnly aria-label="Clear Console" tooltip onClick={() => setLogs({ ...logs, [tab]: [] })}>
              <Trash2 size={16} />
            </Button>
          </div>
        </div>
        {info.length > 0 && (
          <div className="flex flex-wrap gap-x-8 gap-y-3 p-3 shadow-[inset_0_-1px_0_var(--gray-alpha-400)]">
            {info.map((i) => (
              <Description key={i.k} title={i.k} content={i.v} mono={i.mono} />
            ))}
          </div>
        )}
        <div ref={logRef} role="log" aria-label={`${tab} log`} className="flex min-h-0 flex-[1_1_auto] flex-col overflow-y-auto py-2 font-mono text-[13px] leading-5">
          {L.map((l, i) => (
            <div key={i} className="flex gap-3 px-3 py-0.5">
              {f.ts && <span className="w-24 flex-none text-gray-700">{l.t}</span>}
              <span className={`w-5 flex-none text-xs font-medium leading-5 ${l.d === 'TX' ? 'text-[var(--wf-c1)]' : l.d === 'RX' ? 'text-[var(--wf-c2)]' : 'text-gray-700'}`}>{l.d}</span>
              <span className={`min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] ${l.err ? 'text-red-900' : l.d === '··' ? 'italic text-gray-900' : ''}`}>{shown(l)}</span>
              {l.r && (
                <Badge size="sm" variant={l.r === 'ACK' ? 'green-subtle' : 'red-subtle'}>
                  {l.r}
                </Badge>
              )}
            </div>
          ))}
          {L.length === 0 && (
            <div className="m-auto flex flex-col items-center gap-2 font-sans text-sm text-gray-700">
              <SquareTerminal size={20} />
              <p className="m-0">{emptyText}</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 bg-background-100 p-2 shadow-[inset_0_1px_0_var(--gray-alpha-400)]">
          <span className="pl-1 font-mono text-base text-gray-700" aria-hidden>
            ›
          </span>
          {compose[tab]}
        </div>
      </div>
    </SplitPage>
  )
}
