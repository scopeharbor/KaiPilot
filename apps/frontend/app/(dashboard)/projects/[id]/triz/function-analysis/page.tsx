'use client'

// @aiproj/frontend — V3 TRIZ 功能分析图审查 UI 页面
// v3-triz-function-analysis-diagram
//
// 项目级路由：/projects/[id]/triz/function-analysis

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import FunctionAnalysisDiagram from '@/components/views/triz/function-analysis-diagram'
import { Alert } from '@/components/ui/Alert'

export default function FunctionAnalysisPage() {
  const projectId = Number(useParams().id)

  if (!Number.isFinite(projectId) || projectId <= 0) {
    return (
      <Alert variant="danger" className="my-8">
        无效的项目 ID。
      </Alert>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-8 lg:px-10">
      {/* 组件内用 useSearchParams 恢复 runId，需 Suspense 边界 */}
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载中…</div>}>
        <FunctionAnalysisDiagram projectId={projectId} />
      </Suspense>
    </main>
  )
}
