import { EmptyState } from '@robcholz/geist'
import type { ComponentType } from 'react'
import { PageBar } from '../components/Page'
import { pageById, type PageId } from '../routes'
import { useStore } from '../store'
import { Scope } from '../views/Scope'

const views: Partial<Record<PageId, ComponentType>> = {
  scope: Scope
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
