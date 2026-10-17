'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowRightLeft, ShieldAlert } from 'lucide-react'
// W5 单点导入 React Flow 样式（AON 拓扑镜头；仅此一处，防重复注入）
import '@xyflow/react/dist/style.css'
import { PermissionGuard } from '@/components/PermissionGuard'
import { ChartExportMenu } from '@/components/next/charts/ChartExportMenu'
import { ChartGalleryCatalog } from '@/components/next/charts/ChartGalleryCatalog'
import {
  getChartLensEntry,
  type ChartLensComponentProps,
} from '@/components/next/charts/chart-lens-registry'
import { ChartLensToolbar } from '@/components/next/charts/ChartLensToolbar'
import { ProjectChartsContainer } from '@/components/next/charts/ProjectChartsContainer'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'
import { isComingSoonChartId } from '@/lib/next/charts/chart-catalog-metadata'
import type { Project } from '@/lib/api/projects'

/**
 * 具体图表镜头动态路由容器（/next/projects/:id/charts/:chartId，
 * v3-ui-next-chart-gallery tasks 1.8 / spec「三通道可达」）。
 *
 * chartId 解析策略（design §2.1）：
 * - `kanban`：平滑重定向至项目看板主工作面 `/next/projects/:id?lens=kanban`
 *   （复用既有工作面，不重复构建组件；浏览器历史保留目录来源）；
 * - 注册表已就绪的 7 项第一层图表：挂载 ChartLensToolbar（含汇出菜单挂载点，
 *   W5 注入 ChartExportMenu）+ `[data-chart-viewport-slot]` 视口容器，渲染注册表
 *   真实镜头组件（W2-W4 交付，W5 总装）；
 * - 第二层「即将上线」图表 id：平滑回退目录页并自动弹出该图表预告抽屉；
 * - 其余未知 id：回退目录页（零报错）。
 */
export default function ProjectChartLensPage() {
  const params = useParams<{ id: string; chartId: string }>()
  const router = useRouter()
  const rawId = params?.id
  const projectId = Number(rawId)
  const validId = Number.isInteger(projectId) && projectId > 0
  const chartId = typeof params?.chartId === 'string' ? params.chartId : ''

  const isKanbanEntry = chartId === 'kanban'

  // 看板直达：平滑重定向（replace 保持目录来源在历史记录中可返回）。
  React.useEffect(() => {
    if (!validId || !isKanbanEntry) return
    router.replace(`/next/projects/${projectId}?lens=kanban`)
  }, [validId, isKanbanEntry, projectId, router])

  return (
    <PermissionGuard
      require={['project:view']}
      fallback={
        <div
          data-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
        >
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]" />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看该项目图表馆的权限
          </h3>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人授予 project:view 权限。
          </p>
        </div>
      }
    >
      {!validId ? (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      ) : isKanbanEntry ? (
        <div
          data-chart-kanban-redirecting
          role="status"
          aria-label="正在跳转看板工作面"
          className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
        >
          <ArrowRightLeft className="h-6 w-6 text-[var(--nx-accent)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">正在跳转看板工作面…</p>
        </div>
      ) : (
        <ProjectChartsContainer projectId={projectId}>
          {(project) => <ChartLensWorkspace project={project} chartId={chartId} />}
        </ProjectChartsContainer>
      )}
    </PermissionGuard>
  )
}

/** 已就绪镜头工作区：统一顶栏（含汇出菜单）+ 视口容器 + 注册表镜头组件。 */
function ChartLensWorkspace({ project, chartId }: { project: Project; chartId: string }) {
  const entry = getChartLensEntry(chartId)
  if (entry) {
    const Lens = entry.component as React.ComponentType<ChartLensComponentProps>
    return (
      <>
        <ChartLensToolbar
          projectId={project.id}
          definition={entry.definition}
          interactionMode={entry.interactionMode}
          exportSlot={
            <ChartExportMenu entityName={project.name} viewType={entry.exportViewLabel} />
          }
        />
        <section
          data-chart-viewport-slot
          data-chart-viewport={chartId}
          aria-label={`${entry.definition.title}镜头区域`}
          // 外层容器只有 min-h（高度不确定），镜头根节点的 h-full 解析不出高度；
          // 视口区自身做纵向 flex，镜头用 flex-1 撑满（AON/鱼骨画布曾因此 0 高、整张图空白）。
          className="flex min-h-0 flex-1 flex-col"
        >
          <Lens projectId={project.id} />
        </section>
      </>
    )
  }

  // 第二层占位图表 / 未知 id：回退目录（占位 id 自动弹出对应预告抽屉）
  return (
    <ChartGalleryCatalog
      projectId={project.id}
      defaultComingSoonChartId={isComingSoonChartId(chartId) ? chartId : null}
    />
  )
}
