import { EmptyState } from '@robcholz/geist'
import type { ComponentType } from 'react'
import { PageBar } from '../components/Page'
import { pageById, type PageId } from '../routes'
import { useStore } from '../store'
import { Calibration } from '../views/Calibration'
import { DeviceManager } from '../views/DeviceManager'
import { DeviceOptions } from '../views/DeviceOptions'
import { DMM } from '../views/DMM'
import { Export } from '../views/Export'
import { FPGA } from '../views/FPGA'
import { Logic } from '../views/Logic'
import { MCP } from '../views/MCP'
import { Impedance } from '../views/Impedance'
import { Network } from '../views/Network'
import { Patterns } from '../views/Patterns'
import { Protocol } from '../views/Protocol'
import { StaticIO } from '../views/StaticIO'
import { Tracer } from '../views/Tracer'
import { Logger } from '../views/Logger'
import { Scope } from '../views/Scope'
import { Script } from '../views/Script'
import { Settings } from '../views/Settings'
import { Spectrum } from '../views/Spectrum'
import { Supplies } from '../views/Supplies'
import { Voltmeter } from '../views/Voltmeter'
import { Welcome } from '../views/Welcome'
import { Wavegen } from '../views/Wavegen'

const views: Partial<Record<PageId, ComponentType>> = {
  scope: Scope,
  wavegen: Wavegen,
  supplies: Supplies,
  voltmeter: Voltmeter,
  dmm: DMM,
  logger: Logger,
  logic: Logic,
  patterns: Patterns,
  'static-io': StaticIO,
  protocol: Protocol,
  spectrum: Spectrum,
  network: Network,
  impedance: Impedance,
  tracer: Tracer,
  welcome: Welcome,
  device: DeviceManager,
  'device-options': DeviceOptions,
  calibration: Calibration,
  export: Export,
  settings: Settings,
  script: Script,
  mcp: MCP,
  fpga: FPGA
}

export function PageView() {
  const page = useStore((s) => s.page)
  const View = views[page]
  if (View) return <View key={page} />
  const info = pageById[page]
  const Icon = info.icon
  return (
    <>
      <PageBar title={info.title} />
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={<Icon size={20} />} title={info.title} description="This page is next in the build." />
      </div>
    </>
  )
}
