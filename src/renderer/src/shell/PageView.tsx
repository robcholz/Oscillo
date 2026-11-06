import { EmptyState } from '@robcholz/geist'
import type { ComponentType } from 'react'
import { PageBar } from '../components/Page'
import { pageById, type PageId } from '../routes'
import { useStore } from '../store'
import { DMM } from '../views/DMM'
import { Logic } from '../views/Logic'
import { Patterns } from '../views/Patterns'
import { Protocol } from '../views/Protocol'
import { StaticIO } from '../views/StaticIO'
import { Logger } from '../views/Logger'
import { Scope } from '../views/Scope'
import { Supplies } from '../views/Supplies'
import { Voltmeter } from '../views/Voltmeter'
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
  protocol: Protocol
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
