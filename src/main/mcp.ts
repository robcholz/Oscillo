// The MCP server: instruments as tools for Claude, Codex, ChatGPT and other MCP clients.
// Streamable HTTP on 127.0.0.1 (JSON responses, bearer token); stdio clients run the app with
// --mcp-stdio, which relays to this server (see stdioBridge). Outputs follow the permission set for
// each client, asking in the app when approval is needed, and every call goes to the audit log.
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CallToolRequestSchema, ErrorCode, isInitializeRequest, isJSONRPCRequest, ListResourcesRequestSchema, ListToolsRequestSchema,
  ReadResourceRequestSchema, type JSONRPCMessage, type Tool as ToolInfo
} from '@modelcontextprotocol/sdk/types.js'
import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { analyze, metrics } from '../shared/dsp/spectrum'
import { MCP, type AuditRow, type ClientId, type McpEvent, type McpRequest, type McpSettings, type McpStatus, type Perm } from '../shared/mcp'
import { MEASUREMENTS, measure, tone, type MeasurementName } from '../shared/measure'
import { SCRIPT, type ScriptEvent } from '../shared/script'
import { createApi } from './api'
import type { Hardware } from './hardware'
import type { ScriptRunner } from './script'

type Json = Record<string, unknown>
type ToolInput = ToolInfo['inputSchema']
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

interface Session {
  id: string
  client: string
  clientId: ClientId | null
  since: number
  last: number
  allowed: Set<string>
  close: () => void
}

interface Tool {
  name: string
  group: string
  output: boolean
  description: string
  input: Json
  /** What the approval card says, given the arguments. */
  ask?: (a: Json, s: McpSettings) => string
  run: (a: Json, ctx: { session: Session; settings: McpSettings }) => Promise<Content[] | string> | Content[] | string
}

const num = (desc: string, extra: Json = {}): Json => ({ type: 'number', description: desc, ...extra })
const int = (desc: string, extra: Json = {}): Json => ({ type: 'integer', description: desc, ...extra })
const str = (desc: string, extra: Json = {}): Json => ({ type: 'string', description: desc, ...extra })
const obj = (props: Json, required: string[] = []): Json => ({ type: 'object', properties: props, required, additionalProperties: false })
const fmt = (v: number, unit: string) => (Number.isFinite(v) ? `${+v.toPrecision(5)} ${unit}` : 'n/a')

function clientIdOf(name: string): ClientId | null {
  const n = name.toLowerCase()
  if (n.includes('claude-code') || n.includes('claude code')) return 'code'
  if (n.includes('claude')) return 'desktop'
  if (n.includes('codex')) return 'codex'
  if (n.includes('chatgpt') || n.includes('openai')) return 'chatgpt'
  return null
}

/** Where the stdio bridge finds the running app's server. */
const configPath = () => join(app.getPath('userData'), 'mcp.json')

export function registerMcp(hw: Hardware, runScript: ScriptRunner): void {
  let settings: McpSettings | null = null
  let server: Server | null = null
  let listening = { port: 0, error: null as string | null }
  const sessions = new Map<string, Session>()
  const transports = new Map<string, StreamableHTTPServerTransport>()
  const pending = new Map<string, (ok: boolean, session: boolean) => void>()
  const dataDir = join(app.getPath('userData'))
  const send = (e: McpEvent) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(MCP.event, e))
  const mirror = (e: ScriptEvent) => settings?.mirror && BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(SCRIPT.event, e))
  const api = () => createApi({ hw, dataDir, apply: (apply) => mirror({ type: 'apply', apply }) })
  const time = () => new Date().toTimeString().slice(0, 8)
  const status = (): McpStatus => ({
    listening: !!server && listening.port > 0,
    url: `http://127.0.0.1:${settings?.port ?? 8765}/mcp`,
    stdio: `"${process.execPath}" --mcp-stdio`,
    error: listening.error,
    sessions: [...sessions.values()].map((s) => ({ client: s.client, id: s.clientId, since: s.since, last: s.last }))
  })
  const pushStatus = () => send({ type: 'status', status: status() })

  let lastScope: { rate: number; data: Float64Array[] } | null = null
  let lastLogic: { rate: number; data: Uint16Array } | null = null

  const tools: Tool[] = [
    // device
    { name: 'device_list', group: 'device', output: false, description: 'Lists the devices Oscillo can see and which one is open.', input: obj({}), run: () => JSON.stringify({ devices: hw.devices().map((d) => ({ name: d.name, serial: d.serial, link: d.link, busy: d.busy })), open: hw.openInfo() }, null, 1) },
    { name: 'device_info', group: 'device', output: false, description: 'The open device: name, serial number and SDK version.', input: obj({}), run: () => JSON.stringify({ device: hw.openInfo(), sdk: hw.getStatus() }, null, 1) },
    {
      name: 'device_system_monitor',
      group: 'device',
      output: false,
      description: 'USB voltage and current, supply rail readings and device temperature.',
      input: obj({}),
      run: () => JSON.stringify(hw.monitor(), null, 1)
    },
    // scope
    {
      name: 'scope_capture',
      group: 'scope',
      output: false,
      description: 'Captures both scope channels once and returns the main measurements. The samples stay available to scope_get_waveform, scope_measure and the oscillo://scope/last-capture resource.',
      input: obj({
        rate: num('Samples per second (default 1 MS/s).'),
        samples: int('Samples per channel (default 8192).'),
        range: num('Full-scale range in volts (default 10).'),
        trigger_channel: int('1 or 2; leave out to capture without a trigger.', { enum: [1, 2] }),
        trigger_level: num('Trigger level in volts (default 0).'),
        trigger_slope: str('Rise, Fall or Either (default Rise).', { enum: ['Rise', 'Fall', 'Either'] })
      }),
      run: async (a, { settings: s }) => {
        const rate = Math.min(Number(a.rate ?? 1e6), s.maxRate)
        const samples = Math.min(Number(a.samples ?? 8192), 65536)
        const range = Number(a.range ?? 10)
        const r = await hw.scope({ channels: [0, 1], rate, samples, range: { 0: range, 1: range }, trigger: a.trigger_channel ? { channel: Number(a.trigger_channel) - 1, level: Number(a.trigger_level ?? 0), slope: (a.trigger_slope as 'Rise') ?? 'Rise', position: 0, autoTimeout: 1 } : undefined })
        lastScope = r
        const m = (v: Float64Array) => Object.fromEntries((['PeakToPeak', 'Mean', 'RMS', 'Frequency', 'DutyCycle'] as MeasurementName[]).map((k) => [k, +measure(v, r.rate, k).toPrecision(6)]))
        const summary = { rate: r.rate, samples, duration_s: samples / r.rate, channel1: m(r.data[0]), channel2: m(r.data[1]) }
        if (s.large === 'File Path') {
          mkdirSync(dataDir, { recursive: true })
          const path = join(dataDir, `capture-${Date.now()}.csv`)
          writeFileSync(path, csv(r))
          return JSON.stringify({ ...summary, file: path }, null, 1)
        }
        return JSON.stringify({ ...summary, resource: 'oscillo://scope/last-capture' }, null, 1)
      }
    },
    {
      name: 'scope_measure',
      group: 'scope',
      output: false,
      description: `Measures the last capture. Names: ${MEASUREMENTS.join(', ')}.`,
      input: obj({ channel: int('1 or 2', { enum: [1, 2] }), names: { type: 'array', items: { type: 'string', enum: [...MEASUREMENTS] } } }, ['channel', 'names']),
      run: (a) => {
        if (!lastScope) throw new Error('Capture first with scope_capture.')
        const v = lastScope.data[Number(a.channel) - 1]
        return JSON.stringify(Object.fromEntries((a.names as MeasurementName[]).map((n) => [n, measure(v, lastScope!.rate, n)])), null, 1)
      }
    },
    {
      name: 'scope_get_waveform',
      group: 'scope',
      output: false,
      description: 'Samples of one channel of the last capture as CSV (time_s,volts), decimated to the sample limit set in Oscillo.',
      input: obj({ channel: int('1 or 2', { enum: [1, 2] }), points: int('Points to return (at most the limit).') }, ['channel']),
      run: (a, { settings: s }) => {
        if (!lastScope) throw new Error('Capture first with scope_capture.')
        const v = lastScope.data[Number(a.channel) - 1]
        const n = Math.max(2, Math.min(Number(a.points ?? s.maxSamples), s.maxSamples, v.length))
        const step = v.length / n
        const rows = ['time_s,volts']
        for (let k = 0; k < n; k++) {
          const i = Math.floor(k * step)
          rows.push(`${((i - v.length / 2) / lastScope.rate).toExponential(4)},${v[i].toFixed(5)}`)
        }
        return rows.join('\n')
      }
    },
    // wavegen
    {
      name: 'wavegen_run',
      group: 'wavegen',
      output: true,
      description: 'Starts a waveform generator channel.',
      input: obj({ channel: int('1 or 2', { enum: [1, 2] }), type: str('Wave type', { enum: ['Sine', 'Square', 'Triangle', 'RampUp', 'RampDown', 'Noise', 'Pulse', 'Trapezium', 'SinePower', 'DC'] }), frequency: num('Hz'), amplitude: num('Volts'), offset: num('Volts (default 0)'), symmetry: num('Percent (default 50)') }, ['channel', 'type', 'frequency', 'amplitude']),
      ask: (a, s) => `wants to start Wavegen ${a.channel} with a ${fmt(Number(a.frequency), 'Hz')}, ${fmt(Number(a.amplitude), 'V')} ${String(a.type).toLowerCase()}. This is within your ${s.maxAmp} V amplitude limit.`,
      run: async (a, { settings: s }) => {
        if (Math.abs(Number(a.amplitude)) + Math.abs(Number(a.offset ?? 0)) > s.maxAmp) throw new Error(`Amplitude plus offset is over the ${s.maxAmp} V limit set in Oscillo.`)
        const ch = api().wavegen.channel(Number(a.channel) as 1)
        ch.configure({ type: a.type as 'Sine', frequency: Number(a.frequency), amplitude: Number(a.amplitude), offset: Number(a.offset ?? 0), symmetry: Number(a.symmetry ?? 50) })
        await ch.run()
        return `Wavegen ${a.channel} running: ${a.type} ${a.frequency} Hz, ${a.amplitude} V`
      }
    },
    {
      name: 'wavegen_stop',
      group: 'wavegen',
      output: true,
      description: 'Stops a waveform generator channel.',
      input: obj({ channel: int('1 or 2', { enum: [1, 2] }) }, ['channel']),
      ask: (a) => `wants to stop Wavegen ${a.channel}.`,
      run: async (a) => {
        await api().wavegen.channel(Number(a.channel) as 1).stop()
        return `Wavegen ${a.channel} stopped`
      }
    },
    // supplies
    {
      name: 'supplies_set',
      group: 'supplies',
      output: true,
      description: 'Sets a supply rail voltage and turns it on or off (turning a rail on also turns on the master enable).',
      input: obj({ rail: str('positive or negative', { enum: ['positive', 'negative'] }), voltage: num('Volts: 0 to 5 for positive, -5 to 0 for negative'), enable: { type: 'boolean' } }, ['rail']),
      ask: (a, s) => `wants to ${a.voltage !== undefined ? `set the ${a.rail} supply to ${a.voltage} V` : `change the ${a.rail} supply`}${a.enable === true ? ' and turn it on' : a.enable === false ? ' and turn it off' : ''}. This is within your ${s.maxV} V limit.`,
      run: async (a, { settings: s }) => {
        if (a.voltage !== undefined && Math.abs(Number(a.voltage)) > s.maxV) throw new Error(`${a.voltage} V is over the ${s.maxV} V limit set in Oscillo.`)
        const o = api()
        const rail = a.rail === 'negative' ? o.supplies.negative : o.supplies.positive
        rail.set({ voltage: a.voltage as number | undefined, enable: a.enable as boolean | undefined })
        await new Promise((r) => setTimeout(r, 200))
        const m = rail.read()
        if (Math.abs(m.current) > s.maxI) {
          rail.set({ enable: false })
          throw new Error(`The ${a.rail} rail drew ${fmt(m.current, 'A')}, over the ${s.maxI} A limit set in Oscillo, so it was turned off.`)
        }
        return JSON.stringify({ rail: a.rail, measured: m }, null, 1)
      }
    },
    {
      name: 'supplies_enable',
      group: 'supplies',
      output: true,
      description: 'Turns the supplies master enable on or off.',
      input: obj({ on: { type: 'boolean' } }, ['on']),
      ask: (a) => `wants to turn the supplies ${a.on ? 'on' : 'off'}.`,
      run: (a) => {
        api().supplies.enable(!!a.on)
        return `Supplies ${a.on ? 'on' : 'off'}`
      }
    },
    { name: 'supplies_read', group: 'supplies', output: false, description: 'Measured voltage and current of both rails.', input: obj({}), run: () => JSON.stringify({ positive: api().supplies.positive.read(), negative: api().supplies.negative.read() }, null, 1) },
    // static I/O
    { name: 'static_io_read', group: 'static_io', output: false, description: 'Levels of all DIO pins as a bit mask (bit n = DIO n).', input: obj({}), run: () => { const v = hw.dioRead(); return JSON.stringify({ value: v, hex: '0x' + v.toString(16).toUpperCase(), binary: v.toString(2).padStart(16, '0') }) } },
    {
      name: 'static_io_write',
      group: 'static_io',
      output: true,
      description: 'Drives the DIO pins in mask to the levels in value; other pins become inputs.',
      input: obj({ mask: int('Bit mask of pins to drive'), value: int('Levels for those pins') }, ['mask', 'value']),
      ask: (a) => `wants to drive DIO pins 0x${Number(a.mask).toString(16).toUpperCase()} to 0x${Number(a.value).toString(16).toUpperCase()} as outputs.`,
      run: (a) => {
        api().io.write(Number(a.mask), Number(a.value))
        return 'Done'
      }
    },
    // logic
    {
      name: 'logic_capture',
      group: 'logic',
      output: false,
      description: 'Captures the DIO pins once and returns per-pin activity. Decode it with logic_decode.',
      input: obj({ rate: num('Samples per second (default 10 MS/s)'), samples: int('Samples (default 16384)') }),
      run: async (a, { settings: s }) => {
        const r = await hw.logic({ rate: Math.min(Number(a.rate ?? 10e6), 100e6), samples: Number(a.samples ?? 16384) })
        lastLogic = r
        void s
        const pins = Array.from({ length: 16 }, (_, p) => {
          let edges = 0
          for (let i = 1; i < r.data.length; i++) if (((r.data[i] ^ r.data[i - 1]) >> p) & 1) edges++
          return { pin: p, initial: r.data[0] >> p & 1, edges }
        }).filter((x) => x.edges)
        return JSON.stringify({ rate: r.rate, samples: r.data.length, active: pins, resource: 'oscillo://logic/last-capture' }, null, 1)
      }
    },
    {
      name: 'logic_decode',
      group: 'logic',
      output: false,
      description: 'Decodes SPI (mode 0, MSB first) or UART (8N1) from the last logic capture.',
      input: obj({ kind: str('SPI or UART', { enum: ['SPI', 'UART'] }), clock: int('SPI clock pin'), select: int('SPI select pin'), mosi: int('SPI MOSI pin'), miso: int('SPI MISO pin'), rx: int('UART pin'), baud: num('UART baud rate') }, ['kind']),
      run: (a) => {
        if (!lastLogic) throw new Error('Capture first with logic_capture.')
        const r = lastLogic
        const cap = { rate: r.rate, length: r.data.length, level: (p: number, i: number) => ((r.data[i] >> p) & 1) as 0 | 1 }
        const frames = api().logic.interpreter(a.kind as 'SPI', a as Record<string, number>).decode(cap)
        return JSON.stringify(frames.slice(0, 500).map((f) => ({ time_s: f.time, mosi: f.mosi.hex(), miso: f.miso.hex(), text: f.text })), null, 1)
      }
    },
    // patterns
    {
      name: 'patterns_run',
      group: 'patterns',
      output: true,
      description: 'Plays digital patterns on DIO pins until stopped.',
      input: obj({ patterns: { type: 'array', items: obj({ pin: int('DIO pin'), kind: str('Pattern', { enum: ['Clock', 'Pulse', 'Random', 'Custom', 'Constant'] }), frequency: num('Hz (bit rate for Custom)'), duty: num('Percent'), data: { type: 'array', items: { type: 'integer', enum: [0, 1] } } }, ['pin', 'kind', 'frequency']) } }, ['patterns']),
      ask: (a) => `wants to play patterns on DIO ${(a.patterns as { pin: number }[]).map((p) => p.pin).join(', ')}.`,
      run: (a) => {
        hw.patterns(a.patterns as never)
        return 'Patterns running'
      }
    },
    { name: 'patterns_stop', group: 'patterns', output: true, description: 'Stops the pattern generator.', input: obj({}), ask: () => 'wants to stop the pattern generator.', run: () => (hw.patternsStop(), 'Stopped') },
    // protocol
    {
      name: 'uart_send',
      group: 'protocol',
      output: true,
      description: 'Sends text over UART (8N1) and returns what came back within the wait time.',
      input: obj({ tx: int('TX pin'), rx: int('RX pin'), baud: num('Baud rate'), text: str('Text to send'), wait_ms: int('How long to collect the answer (default 200)') }, ['tx', 'rx', 'baud', 'text']),
      ask: (a) => `wants to send ${JSON.stringify(a.text)} over UART at ${a.baud} baud on DIO ${a.tx}.`,
      run: async (a) => {
        hw.protocol('uartSetup', [{ tx: Number(a.tx), rx: Number(a.rx), baud: Number(a.baud) }])
        hw.protocol('uartSend', [[...String(a.text)].map((c) => c.charCodeAt(0) & 0xff)])
        await new Promise((r) => setTimeout(r, Number(a.wait_ms ?? 200)))
        const r = hw.protocol('uartReceive', []) as { data: number[] }
        return JSON.stringify({ received: String.fromCharCode(...r.data) })
      }
    },
    {
      name: 'i2c_transfer',
      group: 'protocol',
      output: true,
      description: 'Writes bytes to a 7-bit I²C address, then reads bytes back.',
      input: obj({ scl: int('SCL pin'), sda: int('SDA pin'), rate: num('Hz (default 100 kHz)'), address: int('7-bit address'), write: { type: 'array', items: { type: 'integer' } }, read: int('Bytes to read (default 0)') }, ['scl', 'sda', 'address']),
      ask: (a) => `wants to talk to I²C address 0x${Number(a.address).toString(16).toUpperCase()}${(a.write as number[] | undefined)?.length ? ` and write ${(a.write as number[]).length} bytes` : ''}.`,
      run: (a) => {
        hw.protocol('i2cSetup', [{ scl: Number(a.scl), sda: Number(a.sda), rate: Number(a.rate ?? 100e3) }])
        return JSON.stringify(hw.protocol('i2cTransfer', [Number(a.address), (a.write as number[]) ?? [], Number(a.read ?? 0)]))
      }
    },
    {
      name: 'spi_transfer',
      group: 'protocol',
      output: true,
      description: 'Selects, writes bytes while reading as many, and deselects (mode 0 unless set).',
      input: obj({ sck: int('Clock pin'), mosi: int('MOSI pin'), miso: int('MISO pin'), cs: int('Select pin'), frequency: num('Hz (default 1 MHz)'), mode: int('0 to 3'), write: { type: 'array', items: { type: 'integer' } } }, ['sck', 'mosi', 'miso', 'cs', 'write']),
      ask: (a) => `wants to send ${(a.write as number[]).length} bytes over SPI.`,
      run: (a) => {
        hw.protocol('spiSetup', [{ sck: Number(a.sck), mosi: Number(a.mosi), miso: Number(a.miso), cs: Number(a.cs), frequency: Number(a.frequency ?? 1e6), mode: Number(a.mode ?? 0) }])
        return JSON.stringify({ read: hw.protocol('spiTransfer', [a.write as number[]]) })
      }
    },
    {
      name: 'can_send',
      group: 'protocol',
      output: true,
      description: 'Sends one CAN frame.',
      input: obj({ tx: int('TX pin'), rx: int('RX pin'), rate: num('bit/s (default 500 k)'), id: int('Frame ID'), extended: { type: 'boolean' }, data: { type: 'array', items: { type: 'integer' }, maxItems: 8 } }, ['tx', 'rx', 'id']),
      ask: (a) => `wants to send CAN frame 0x${Number(a.id).toString(16).toUpperCase()}.`,
      run: (a) => {
        hw.protocol('canSetup', [{ tx: Number(a.tx), rx: Number(a.rx), rate: Number(a.rate ?? 500e3) }])
        hw.protocol('canSend', [{ id: Number(a.id), extended: !!a.extended, remote: false, data: (a.data as number[]) ?? [] }])
        return 'Sent'
      }
    },
    // spectrum
    {
      name: 'spectrum_measure',
      group: 'spectrum',
      output: false,
      description: 'Captures a channel and returns the fundamental, harmonics, THD, SNR, SINAD and ENOB.',
      input: obj({ channel: int('1 or 2', { enum: [1, 2] }), rate: num('Samples per second (default 100 kS/s)'), samples: int('Samples (default 16384)') }, ['channel']),
      run: async (a, { settings: s }) => {
        const rate = Math.min(Number(a.rate ?? 100e3), s.maxRate)
        const r = await hw.scope({ channels: [Number(a.channel) - 1], rate, samples: Number(a.samples ?? 16384), range: { [Number(a.channel) - 1]: 10 } })
        return JSON.stringify(metrics(analyze(r.data[0], r.rate, 'Flat Top')), null, 1)
      }
    },
    // network
    {
      name: 'network_sweep',
      group: 'network',
      output: true,
      description: 'Bode sweep: W1 drives the circuit, C1 reads its input and C2 its output. Returns gain (dB) and phase (degrees) per frequency.',
      input: obj({ start: num('Hz'), stop: num('Hz'), steps: int('Points (default 20)'), amplitude: num('Volts (default 1)') }, ['start', 'stop']),
      ask: (a) => `wants to sweep Wavegen 1 from ${fmt(Number(a.start), 'Hz')} to ${fmt(Number(a.stop), 'Hz')} at ${a.amplitude ?? 1} V.`,
      run: async (a, { settings: s }) => {
        const amp = Number(a.amplitude ?? 1)
        if (amp > s.maxAmp) throw new Error(`${amp} V is over the ${s.maxAmp} V amplitude limit set in Oscillo.`)
        const steps = Math.max(2, Math.min(200, Number(a.steps ?? 20)))
        const out: { f: number; gain_db: number; phase_deg: number }[] = []
        try {
          for (let k = 0; k < steps; k++) {
            const f = Number(a.start) * (Number(a.stop) / Number(a.start)) ** (k / (steps - 1))
            const [c1, c2] = await respond(f, amp)
            const g = Math.hypot(c2.re, c2.im) / Math.max(1e-12, Math.hypot(c1.re, c1.im))
            out.push({ f: +f.toPrecision(5), gain_db: +(20 * Math.log10(g)).toFixed(2), phase_deg: +(((Math.atan2(c2.im, c2.re) - Math.atan2(c1.im, c1.re)) * 180) / Math.PI).toFixed(1) })
          }
        } finally {
          hw.wavegenStop(0)
        }
        return JSON.stringify(out)
      }
    },
    // impedance
    {
      name: 'impedance_measure',
      group: 'impedance',
      output: true,
      description: 'Impedance at one frequency: W1 → C1 → DUT → C2 → reference resistor → ground.',
      input: obj({ frequency: num('Hz'), reference: num('Reference resistor in ohms (default 1000)'), amplitude: num('Volts (default 1)') }, ['frequency']),
      ask: (a) => `wants to measure impedance at ${fmt(Number(a.frequency), 'Hz')} using Wavegen 1.`,
      run: async (a, { settings: s }) => {
        const amp = Number(a.amplitude ?? 1)
        if (amp > s.maxAmp) throw new Error(`${amp} V is over the ${s.maxAmp} V amplitude limit set in Oscillo.`)
        try {
          const [v1, v2] = await respond(Number(a.frequency), amp)
          const R = Number(a.reference ?? 1000)
          const d = v2.re * v2.re + v2.im * v2.im || 1e-30
          const nre = v1.re - v2.re
          const nim = v1.im - v2.im
          const z = { re: (R * (nre * v2.re + nim * v2.im)) / d, im: (R * (nim * v2.re - nre * v2.im)) / d }
          return JSON.stringify({ frequency: Number(a.frequency), z_ohms: Math.hypot(z.re, z.im), phase_deg: (Math.atan2(z.im, z.re) * 180) / Math.PI, resistance: z.re, reactance: z.im })
        } finally {
          hw.wavegenStop(0)
        }
      }
    },
    // workspace
    { name: 'workspace_state', group: 'workspace', output: false, description: 'Settings and run state of every instrument page in Oscillo.', input: obj({}), run: () => workspaceState() },
    {
      name: 'screenshot',
      group: 'screenshot',
      output: false,
      description: 'A picture of the Oscillo window as it is now.',
      input: obj({}),
      run: async () => {
        const w = BrowserWindow.getAllWindows()[0]
        if (!w) throw new Error('Oscillo has no window open')
        const img = await w.webContents.capturePage()
        return [{ type: 'image', data: img.toPNG().toString('base64'), mimeType: 'image/png' }]
      }
    },
    // script
    {
      name: 'script_run',
      group: 'script',
      output: true,
      description: 'Runs a TypeScript script against the Oscillo API (import { scope, wavegen, supplies, logic, io, wait, File } from "oscillo") and returns what it printed.',
      input: obj({ code: str('TypeScript source'), timeout_s: int('Seconds (default 30)') }, ['code']),
      ask: (a) => `wants to run a script that can drive outputs:\n${String(a.code).slice(0, 400)}`,
      run: async (a) => {
        const lines: string[] = []
        let failed = ''
        await runScript({ 'agent.ts': String(a.code) }, 'agent.ts', { timeout: Number(a.timeout_s ?? 30), breakpoints: {}, network: false }, (e) => {
          if (e.type === 'console') lines.push(e.text)
          else if (e.type === 'apply') mirror(e)
          else if (e.type === 'done' && !e.ok) failed = e.error ?? 'stopped'
        })
        if (failed) throw new Error(`${failed}\n${lines.join('\n')}`)
        return lines.join('\n') || '(no output)'
      }
    }
  ]

  async function respond(f: number, amp: number) {
    hw.wavegen(0, { func: 'Sine', frequency: f, amplitude: amp, offset: 0, symmetry: 50, phase: 0 })
    await new Promise((r) => setTimeout(r, Math.min(1000, 20 + 2000 / f)))
    const rate = Math.min(100e6, Math.max(1e3, (f * 4096) / 8))
    const r = await hw.scope({ channels: [0, 1], rate, samples: 4096, range: { 0: Math.max(1, amp * 2.5), 1: Math.max(1, amp * 2.5) } })
    return [tone(r.data[0], r.rate, f), tone(r.data[1], r.rate, f)]
  }

  function csv(r: { rate: number; data: Float64Array[] }): string {
    const rows = ['time_s,ch1_v,ch2_v']
    const n = r.data[0].length
    for (let i = 0; i < n; i++) rows.push(`${((i - n / 2) / r.rate).toExponential(6)},${r.data[0][i].toFixed(5)},${r.data[1][i].toFixed(5)}`)
    return rows.join('\n')
  }

  async function workspaceState(): Promise<string> {
    const w = BrowserWindow.getAllWindows()[0]
    if (!w) return '{}'
    return w.webContents.executeJavaScript(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('oscillo') && k !== 'oscillo.script' && k !== 'oscillo.mcp').map((k) => { try { return [k.replace('oscillo.', '') || 'app', JSON.parse(localStorage[k]).state] } catch { return [k, null] } })), null, 1)`)
  }

  const RESOURCES = [
    { uri: 'oscillo://device', name: 'Device', description: 'Connected device and SDK.', mimeType: 'application/json' },
    { uri: 'oscillo://instruments/state', name: 'Instrument state', description: 'Settings and run state of every instrument.', mimeType: 'application/json' },
    { uri: 'oscillo://scope/last-capture', name: 'Last scope capture', description: 'The most recent scope_capture as CSV.', mimeType: 'text/csv' },
    { uri: 'oscillo://logic/last-capture', name: 'Last logic capture', description: 'The most recent logic_capture: one 16-bit word per sample.', mimeType: 'application/json' }
  ]
  async function readResource(uri: string): Promise<string> {
    if (uri === 'oscillo://device') return JSON.stringify({ device: hw.openInfo(), sdk: hw.getStatus() }, null, 1)
    if (uri === 'oscillo://instruments/state') return workspaceState()
    if (uri === 'oscillo://scope/last-capture') {
      if (!lastScope) throw new Error('No capture yet')
      return csv(lastScope)
    }
    if (uri === 'oscillo://logic/last-capture') {
      if (!lastLogic) throw new Error('No capture yet')
      return JSON.stringify({ rate: lastLogic.rate, words: [...lastLogic.data] })
    }
    throw new Error(`Unknown resource ${uri}`)
  }

  const permOf = (s: Session, st: McpSettings): Perm => (s.clientId ? st.perms[s.clientId] : st.perm)
  const audit = (row: Omit<AuditRow, 't'>) => send({ type: 'audit', row: { ...row, t: time() } })

  async function callTool(s: Session, name: string, args: Json): Promise<{ content: Content[]; isError?: boolean }> {
    const st = settings!
    const tool = tools.find((t) => t.name === name)
    const label = name.replace('_', '.')
    if (!tool || !st.tools[tool.group]) return { content: [{ type: 'text', text: `Unknown or disabled tool ${name}` }], isError: true }
    const id = randomUUID()
    if (tool.output) {
      const perm = permOf(s, st)
      if (perm === 'Read Only') {
        audit({ id, c: s.client, tool: label, r: 'Denied', detail: 'Read Only' })
        return { content: [{ type: 'text', text: `${s.client} has Read Only access in Oscillo, so ${name} was denied. The user can change this on the MCP Server page.` }], isError: true }
      }
      if (perm === 'Outputs with Approval' && !s.allowed.has(name)) {
        audit({ id, c: s.client, tool: label, r: 'Pending' })
        const req: McpRequest = { id, client: s.client, tool: label, text: `${s.client} ${tool.ask?.(args, st) ?? `wants to run ${name}.`}`, data: { tool: label, ...args } }
        send({ type: 'request', request: req })
        const [ok, session] = await new Promise<[boolean, boolean]>((res) => {
          const timer = setTimeout(() => (pending.delete(id), send({ type: 'cancel', id }), res([false, false])), 120_000)
          pending.set(id, (ok, session) => (clearTimeout(timer), res([ok, session])))
        })
        if (session && ok) s.allowed.add(name)
        if (!ok) {
          audit({ id, c: s.client, tool: label, r: 'Denied' })
          return { content: [{ type: 'text', text: `The user denied ${name} in Oscillo.` }], isError: true }
        }
      }
    }
    try {
      const out = await tool.run(args, { session: s, settings: st })
      audit({ id, c: s.client, tool: label, r: 'Allowed' })
      return { content: typeof out === 'string' ? [{ type: 'text', text: out }] : out }
    } catch (e) {
      const msg = (e as Error).message
      audit({ id, c: s.client, tool: label, r: 'Error', detail: msg })
      return { content: [{ type: 'text', text: msg }], isError: true }
    }
  }

  const INSTRUCTIONS =
    'Oscillo controls a Digilent test instrument (oscilloscope, waveform generator, supplies, logic analyzer and more). Capture with scope_capture before measuring. Outputs may need the user to approve them in Oscillo.'

  /** One MCP session: the SDK's protocol server on a Streamable HTTP transport. */
  function openSession(clientId: ClientId | null, clientName: string): StreamableHTTPServerTransport {
    const mcp = new McpServer({ name: 'oscillo', title: 'Oscillo', version: app.getVersion() }, { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS })
    let session: Session | null = null
    const live = (): Session => {
      if (!session) throw Object.assign(new Error('Send initialize first'), { code: ErrorCode.InvalidRequest })
      session.last = Date.now()
      return session
    }
    mcp.setRequestHandler(ListToolsRequestSchema, () => {
      live()
      return { tools: tools.filter((t) => settings!.tools[t.group]).map((t) => ({ name: t.name, description: t.description, inputSchema: t.input as ToolInput, annotations: { readOnlyHint: !t.output } })) }
    })
    mcp.setRequestHandler(CallToolRequestSchema, (r) => callTool(live(), r.params.name, (r.params.arguments ?? {}) as Json))
    mcp.setRequestHandler(ListResourcesRequestSchema, () => (live(), { resources: RESOURCES }))
    mcp.setRequestHandler(ReadResourceRequestSchema, async (r) => {
      live()
      const uri = r.params.uri
      try {
        return { contents: [{ uri, mimeType: RESOURCES.find((x) => x.uri === uri)?.mimeType, text: await readResource(uri) }] }
      } catch (e) {
        // A plain error with a code, so the message is not prefixed twice.
        throw Object.assign(new Error((e as Error).message), { code: -32002 })
      }
    })
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        session = { id, client: clientName, clientId, since: Date.now(), last: Date.now(), allowed: new Set(), close: () => void transport.close() }
        sessions.set(id, session)
        pushStatus()
      }
    })
    transport.onclose = () => {
      if (session && sessions.get(session.id) === session) sessions.delete(session.id)
      if (session) transports.delete(session.id)
      pushStatus()
    }
    void mcp.connect(transport)
    return transport
  }

  const NAMES: Record<ClientId, string> = { desktop: 'Claude Desktop', code: 'Claude Code', codex: 'Codex', chatgpt: 'ChatGPT' }
  const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', id: null, error: { code, message } })

  async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (!req.url?.startsWith('/mcp')) return reply(404, { error: 'Not found' })
    if (req.headers.authorization !== `Bearer ${settings?.token}`) return reply(401, rpcError(-32001, 'Missing or wrong token. Copy it from the MCP Server page in Oscillo.'))
    // Only local pages may call; browsers send Origin.
    if (req.headers.origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)) return reply(403, rpcError(-32001, 'Origin not allowed'))
    const sid = req.headers['mcp-session-id'] as string | undefined
    const session = sid ? sessions.get(sid) : undefined
    if (session?.clientId && !settings?.clients[session.clientId]) return reply(403, rpcError(-32001, 'This client was disconnected in Oscillo.'))
    let body: unknown
    if (req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      try {
        body = JSON.parse(raw)
      } catch {
        return reply(400, rpcError(-32700, 'Parse error'))
      }
    }
    if (session) return (transports.get(session.id) as StreamableHTTPServerTransport).handleRequest(req, res, body)
    if (sid) return reply(404, rpcError(-32001, 'Session expired. Initialize again.'))
    if (req.method !== 'POST' || !isInitializeRequest(body)) return reply(400, rpcError(-32600, 'Send initialize first'))
    const name = body.params.clientInfo.name ?? ''
    const clientId = clientIdOf(name)
    if (clientId && !settings!.clients[clientId]) return reply(403, rpcError(-32001, 'This client is disconnected in Oscillo. Allow it to reconnect on the MCP Server page.'))
    const transport = openSession(clientId, clientId ? NAMES[clientId] : name || 'MCP client')
    await transport.handleRequest(req, res, body)
    if (transport.sessionId) transports.set(transport.sessionId, transport)
  }

  function restart(): void {
    const st = settings!
    const want = st.on ? st.port : 0
    if (server && listening.port === want) return
    server?.close()
    server = null
    listening = { port: 0, error: null }
    for (const x of sessions.values()) x.close()
    sessions.clear()
    transports.clear()
    if (!want) return pushStatus()
    const s = createServer((req, res) => void onRequest(req, res).catch((e) => (res.writeHead(500), res.end(String(e)))))
    s.on('error', (e: NodeJS.ErrnoException) => {
      listening = { port: 0, error: e.code === 'EADDRINUSE' ? `Port ${want} is in use. Choose another port.` : e.message }
      server = null
      pushStatus()
    })
    s.listen(want, '127.0.0.1', () => {
      listening = { port: want, error: null }
      pushStatus()
    })
    server = s
    // The stdio bridge reads the port and token from here.
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(configPath(), JSON.stringify({ port: st.port, token: st.token }), { mode: 0o600 })
    } catch {
      /* best effort */
    }
  }

  ipcMain.handle(MCP.settings, (_e, s: McpSettings) => {
    const prev = settings
    settings = s
    if (!prev || prev.on !== s.on || prev.port !== s.port || prev.token !== s.token) {
      if (prev && prev.token !== s.token && server) listening.port = -1 // force a restart
      restart()
    }
    for (const x of sessions.values()) if (x.clientId && !s.clients[x.clientId]) x.close()
    return status()
  })
  ipcMain.handle(MCP.resolve, (_e, id: string, ok: boolean, session: boolean) => {
    pending.get(id)?.(ok, session)
    pending.delete(id)
  })
  ipcMain.handle(MCP.disconnect, (_e, c: ClientId) => {
    for (const x of sessions.values()) if (x.clientId === c) x.close()
    pushStatus()
  })
  app.on('before-quit', () => server?.close())
}

/**
 * `Oscillo --mcp-stdio`: what stdio clients (Claude Desktop, Codex) launch. Relays MCP messages
 * between stdio and the running app's Streamable HTTP server, using the SDK's transports.
 */
export async function stdioBridge(): Promise<void> {
  let cfg: { port: number; token: string }
  try {
    cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {
    cfg = { port: 8765, token: '' }
  }
  const stdio = new StdioServerTransport()
  const http = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${cfg.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } } })
  const fail = (m: JSONRPCMessage, e: unknown) => {
    if (!isJSONRPCRequest(m)) return
    const text = String((e as Error)?.message ?? e)
    const message = /ECONNREFUSED|fetch failed/.test(text) ? 'Oscillo is not running, or its MCP server is off. Open Oscillo and turn on the server.' : text
    void stdio.send({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message } })
  }
  stdio.onmessage = (m) => void http.send(m).catch((e) => fail(m, e))
  http.onmessage = (m) => void stdio.send(m)
  http.onerror = () => {}
  stdio.onclose = () => void http.close().finally(() => app.exit(0))
  await http.start()
  await stdio.start()
}
