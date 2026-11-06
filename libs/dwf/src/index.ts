// @oscillo/dwf: the WaveForms SDK for Oscillo. See README.md.
export * as dwf from './generated'
export type { DwfRaw } from './generated'
export { DwfLoadError, findLibrary, libraryCandidates, loadDwf } from './load'
export { Device, Dwf, DwfError } from './device'
export type { DeviceConfig, DeviceInfo, IOChannel, IONode, Modulation, ScopeCapture, ScopeChannel, ScopeResult, Slope, WaveFunc, WaveSettings } from './device'
export { createSimDwf, type SimOptions } from './sim'
