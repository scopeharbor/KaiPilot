'use client'

// @aiproj/frontend — V3 TRIZ 矛盾矩阵审查 UI 页面
// v3-triz-contradiction-matrix-ui / tasks §7.1
//
// 项目级路由：/projects/[id]/triz/contradiction-matrix
// 作为独立项目页面实现，预留可嵌入面板接口以备 Decision Center 后续聚合。

import { useParams } from 'next/navigation'
import { TrizContradictionMatrixView } from '@/components/views/triz/TrizContradictionMatrixView'

export default function TrizContradictionMatrixPage() {
  const projectId = Number(useParams().id)

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-8 lg:px-10">
      <TrizContradictionMatrixView projectId={projectId} />
    </main>
  )
}
