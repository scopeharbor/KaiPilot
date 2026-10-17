'use client'

// @aiproj/frontend — V3 TRIZ 资源分析器审查页面
// v3-triz-resource-analyzer §7.4 / §7.10
//
// 项目级路由：/projects/[id]/triz-resource-analyzer

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import TrizResourceAnalyzer from '@/components/views/triz/triz-resource-analyzer'
import { usePermissions } from '@/hooks/use-permissions'
import { Alert } from '@/components/ui/Alert'

export default function TrizResourceAnalyzerPage() {
  const projectId = Number(useParams().id)
  const { can } = usePermissions()

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
        <TrizResourceAnalyzer
          projectId={projectId}
          canView={can('triz_resource_analyzer:view')}
          canManage={can('triz_resource_analyzer:manage')}
          canAiExplain={can('ai:trigger')}
        />
      </Suspense>
    </main>
  )
}
