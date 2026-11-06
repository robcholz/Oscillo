// Every page in the app, in sidebar order. `key` is the ⌘ shortcut.
import type { ComponentType } from 'react'
import {
  Activity, AudioWaveform, Binary, Cable, ChartColumn, ChartSpline, Cpu, Download, Gauge, Layers, Omega, Ruler,
  ScrollText, Settings, SlidersHorizontal, Spline, SquareTerminal, ToggleLeft, Usb, Waves, Zap
} from 'lucide-react'
import { ModelContextProtocolIcon, MultimeterIcon } from './components/icons'

export type PageId =
  | 'welcome' | 'device' | 'device-options' | 'calibration' | 'export'
  | 'scope' | 'wavegen' | 'supplies' | 'voltmeter' | 'dmm' | 'logger'
  | 'logic' | 'patterns' | 'static-io' | 'protocol'
  | 'spectrum' | 'network' | 'impedance' | 'tracer'
  | 'script' | 'mcp' | 'settings' | 'fpga'

export interface PageInfo {
  id: PageId
  /** Short name in the sidebar. */
  label: string
  /** Full name in the page title and search. */
  title: string
  icon: ComponentType<{ size?: number; className?: string }>
  group: 'Workspace' | 'Instruments' | 'Analysis' | 'Automation' | 'App'
  key?: string
  keywords?: string
}

const all: PageInfo[] = [
  { id: 'welcome', label: 'Welcome', title: 'Welcome', icon: Layers, group: 'Workspace', keywords: 'home start recent' },
  { id: 'device', label: 'Device', title: 'Device Manager', icon: Usb, group: 'Workspace', keywords: 'connect' },
  { id: 'device-options', label: 'Device Options', title: 'Device Options', icon: SlidersHorizontal, group: 'Workspace', keywords: 'clock trigger' },
  { id: 'calibration', label: 'Calibration', title: 'Calibration', icon: Ruler, group: 'Workspace' },
  { id: 'export', label: 'Export & Logging', title: 'Export and Logging', icon: Download, group: 'Workspace', keywords: 'save file' },
  { id: 'scope', label: 'Scope', title: 'Oscilloscope', icon: Activity, group: 'Instruments', key: '1', keywords: 'scope analog in channel trigger' },
  { id: 'wavegen', label: 'Wavegen', title: 'Waveform Generator', icon: AudioWaveform, group: 'Instruments', key: '2', keywords: 'wavegen awg analog out sine' },
  { id: 'supplies', label: 'Supplies', title: 'Power Supplies', icon: Zap, group: 'Instruments', key: '3', keywords: 'supply voltage current' },
  { id: 'voltmeter', label: 'Voltmeter', title: 'Voltmeter', icon: Gauge, group: 'Instruments', keywords: 'dc ac rms' },
  { id: 'dmm', label: 'DMM', title: 'Digital Multimeter', icon: MultimeterIcon, group: 'Instruments', keywords: 'dmm resistance' },
  { id: 'logger', label: 'Logger', title: 'Data Logger', icon: ScrollText, group: 'Instruments', keywords: 'log record' },
  { id: 'logic', label: 'Logic', title: 'Logic Analyzer', icon: Binary, group: 'Instruments', key: '4', keywords: 'digital in interpreter spi i2c uart' },
  { id: 'patterns', label: 'Patterns', title: 'Pattern Generator', icon: Waves, group: 'Instruments', keywords: 'digital out clock' },
  { id: 'static-io', label: 'Static I/O', title: 'Static I/O', icon: ToggleLeft, group: 'Instruments', keywords: 'dio led switch button' },
  { id: 'protocol', label: 'Protocol', title: 'Protocol', icon: Cable, group: 'Instruments', keywords: 'uart serial terminal spi i2c can cec jtag swd avr bus debug' },
  { id: 'spectrum', label: 'Spectrum', title: 'Spectrum Analyzer', icon: ChartColumn, group: 'Analysis', key: '5', keywords: 'fft frequency' },
  { id: 'network', label: 'Network', title: 'Network Analyzer', icon: ChartSpline, group: 'Analysis', keywords: 'bode gain phase' },
  { id: 'impedance', label: 'Impedance', title: 'Impedance Analyzer', icon: Omega, group: 'Analysis', keywords: 'lcr' },
  { id: 'tracer', label: 'Curve Tracer', title: 'Curve Tracer', icon: Spline, group: 'Analysis', keywords: 'iv transistor diode' },
  { id: 'script', label: 'Script', title: 'Script', icon: SquareTerminal, group: 'Automation', key: '6', keywords: 'typescript automation' },
  { id: 'mcp', label: 'MCP Server', title: 'MCP Server', icon: ModelContextProtocolIcon, group: 'Automation', keywords: 'agent claude' },
  { id: 'settings', label: 'Settings', title: 'Settings', icon: Settings, group: 'App', key: ',', keywords: 'preferences theme' },
  { id: 'fpga', label: 'FPGA Utility', title: 'FPGA Utility', icon: Cpu, group: 'App', keywords: 'program bitstream' }
]

/** Pages that are not real yet stay out of the sidebar, search and shortcuts. */
const HIDDEN: PageId[] = []
export const pages: PageInfo[] = all.filter((p) => !HIDDEN.includes(p.id))

export const pageById = Object.fromEntries(all.map((p) => [p.id, p])) as Record<PageId, PageInfo>
