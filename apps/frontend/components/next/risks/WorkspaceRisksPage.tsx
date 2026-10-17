'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import {
  isNotFoundError,
  ProjectSpaceErrorView,
  ProjectSpaceNotFoundView,
  ProjectSpaceSkeleton,
} from '@/components/next/project-space/ProjectSpaceContainer'
import type { RiskCellRef } from '@/components/next/charts/risk/risk-meta'
import { RiskAiSuggestionDrawer } from './RiskAiSuggestionDrawer'
import { RiskCandidateList } from './RiskCandidateList'
import { RiskCreateDrawer } from './RiskCreateDrawer'
import { RiskEditDrawer } from './RiskEditDrawer'
import { RiskOperationalMatrix } from './RiskOperationalMatrix'
import { RiskOperationalTable } from './RiskOperationalTable'
import { RiskReviewQueue } from './RiskReviewQueue'
import { RiskStatCards } from './RiskStatCards'

/**
 * 风险域新轨工作台总装容器（v3-ui-next-risk-change-domains W1 · tasks 1.1，
 * spec「风险域新轨工作面路由与工作台总览」）。
 *
 * - 项目详情经 projectsApi.get 载入（与主工作面同键 projectKeys.detail，RL-04）；
 * - RL-05 组织隔离：跨组织 / HTTP 404 统一中性空态「项目不存在或已被移除」；
 * - 三态工作面视图（工作台 workbench / 登记册 table / 矩阵 matrix）本地状态切换，
 *   不写入 URL（页面上下文稳定）；矩阵态持有选中单元格与下方底册联动收敛；
 * - 顶栏提供「返回项目空间」动线、全局刷新与新建 / AI 建议抽屉呼出（权限门禁：
 *   写能力按 risk:manage 主集 + 细分 risk:create/update/delete 兼容判定）；
 * - 抽屉层：新建（RiskCreateDrawer）、编辑（RiskEditDrawer，riskId 驱动的详情读取）、
 *   AI 风险建议（RiskAiSuggestionDrawer，RL-01 人工确认闭环）；
 * - 沉浸阶梯：immersive/light 消费 .nx-space-atmosphere 深空光晕，precise 纯色降级。
 */

type RisksViewId = 'workbench' | 'table' | 'matrix'

const VIEW_TABS: ReadonlyArray<{ id: RisksViewId; label: string }> = [
  { id: 'workbench', label: '工作台' },
  { id: 'table', label: '登记册' },
  { id: 'matrix', label: '矩阵' },
]

export function WorkspaceRisksPage({ projectId }: { projectId: number }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const { canAny } = usePermissions()
  const register = useProjectSpaceEntityStore((state) => state.register)
  const clear = useProjectSpaceEntityStore((state) => state.clear)
  const tier = useImmersionTier()

  const [view, setView] = React.useState<RisksViewId>('workbench')
  const [selectedCell, setSelectedCell] = React.useState<RiskCellRef | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [aiOpen, setAiOpen] = React.useState(false)
  const [editRiskId, setEditRiskId] = React.useState<number | null>(null)

  // 写能力门禁（设计 D6：risk:manage 为主集，兼容细分 risk:create/update/delete 声明）。
  const canCreateRisk = canAny(['risk:manage', 'risk:create'])
  const canManageRisk = canAny(['risk:manage', 'risk:create', 'risk:update', 'risk:delete'])

  const {
    data: project,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  })

  // RL-05 组织隔离：跨组织项目视同不存在。
  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const notFound = orgMismatch || (isError && isNotFoundError(error))

  // 顶栏坐标联动：加载成功且组织校验通过后上报项目名（NextAppShell 面包屑回显）。
  React.useEffect(() => {
    if (project !== undefined && !orgMismatch) {
      register(projectId, project.name)
    } else {
      clear(projectId)
    }
    return () => clear(projectId)
  }, [project, orgMismatch, projectId, register, clear])

  // 全局刷新：统一失效风险域全部缓存（登记底册 / 矩阵 / 工作台摘要 / 队列 / 候选）。
  const refreshAll = React.useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['risks'] }),
      queryClient.invalidateQueries({ queryKey: ['risks-v2'] }),
      queryClient.invalidateQueries({ queryKey: ['risk-matrix'] }),
    ])
  }, [queryClient])

  if (isPending) {
    return <ProjectSpaceSkeleton />
  }
  if (notFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (isError || project === undefined) {
    return (
      <ProjectSpaceErrorView
        onRetry={() => void refetch()}
        onBackHome={() => router.push('/next')}
      />
    )
  }

  const openRiskEditor = (riskId: number) => {
    setSelectedCell(null)
    setEditRiskId(riskId)
  }

  return (
    <div
      data-risk-workspace-space
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 顶栏：返回动线 + 域标题 + 全局刷新 / AI 建议 / 新建 */}
      <header
        data-risk-workspace-header
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-risk-back-to-space
            aria-label="返回项目空间"
            onClick={() => router.push(`/next/projects/${projectId}`)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回项目空间
          </button>
          <span aria-hidden className="h-6 w-px bg-[var(--nx-border-hairline)]" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2
                data-risk-workspace-title
                className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
              >
                {project.name} · 风险管理
              </h2>
              <span
                data-risk-workspace-code
                className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-xs text-[var(--nx-text-muted)]"
              >
                #{project.code ?? `PROJ-${project.id}`}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
              风险态势总览 · 复查队列 · 规则候选评估 · 登记底册 · 5×5 矩阵 · AI 建议审查
            </p>
          </div>
        </div>

        <div className="flex max-w-full flex-wrap items-center gap-2">
          <button
            type="button"
            data-risk-refresh-all
            aria-label="刷新风险数据"
            onClick={refreshAll}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            全局刷新
          </button>
          {canCreateRisk ? (
            <button
              type="button"
              data-risk-ai-open
              onClick={() => setAiOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              AI 风险建议
            </button>
          ) : null}
          {canCreateRisk ? (
            <button
              type="button"
              data-risk-create-open
              onClick={() => setCreateOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建风险
            </button>
          ) : null}
        </div>
      </header>

      {/* 三态工作面视图切换（本地状态，页面 URL 稳定） */}
      <div
        role="tablist"
        aria-label="风险工作面视图"
        data-risk-view-tabs
        className="flex w-fit items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
      >
        {VIEW_TABS.map((tab) => {
          const active = view === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-risk-view-tab={tab.id}
              aria-selected={active}
              aria-label={`${tab.label}视图`}
              onClick={() => setView(tab.id)}
              className={cn(
                'h-7 rounded-sm px-3 text-xs transition-colors',
                active
                  ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                  : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* 视图内容（条件挂载，切换即卸载非当前视图的数据请求） */}
      {view === 'workbench' ? (
        <section data-risk-workbench-view className="flex flex-col gap-4">
          <RiskStatCards
            projectId={projectId}
            onOpenRisk={openRiskEditor}
            onCreateRisk={canCreateRisk ? () => setCreateOpen(true) : undefined}
            onOpenAiSuggestions={canCreateRisk ? () => setAiOpen(true) : undefined}
          />
          <RiskReviewQueue projectId={projectId} />
          <RiskCandidateList projectId={projectId} canEvaluate={canManageRisk} />
        </section>
      ) : null}

      {view === 'table' ? (
        <section data-risk-table-view className="flex flex-col gap-4">
          <RiskOperationalTable
            projectId={projectId}
            cellFilter={null}
            onClearCellFilter={() => setSelectedCell(null)}
            onEditRisk={openRiskEditor}
          />
        </section>
      ) : null}

      {view === 'matrix' ? (
        <section data-risk-matrix-view className="flex flex-col gap-4">
          <RiskOperationalMatrix
            projectId={projectId}
            selectedCell={selectedCell}
            onSelectCell={setSelectedCell}
          />
          <RiskOperationalTable
            projectId={projectId}
            cellFilter={selectedCell}
            onClearCellFilter={() => setSelectedCell(null)}
            onEditRisk={openRiskEditor}
          />
        </section>
      ) : null}

      {/* 操作抽屉层 */}
      <RiskCreateDrawer
        projectId={projectId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <RiskEditDrawer
        projectId={projectId}
        riskId={editRiskId}
        open={editRiskId !== null}
        onClose={() => setEditRiskId(null)}
      />
      <RiskAiSuggestionDrawer
        projectId={projectId}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </div>
  )
}

export default WorkspaceRisksPage
