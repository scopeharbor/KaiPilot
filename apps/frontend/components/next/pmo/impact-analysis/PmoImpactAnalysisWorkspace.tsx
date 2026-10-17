'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, FlaskConical } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import type { MultiProjectImpactListQuery } from '@aiproj/types'
import { PmoImpactPlanRunPanel } from './PmoImpactPlanRunPanel'
import {
  PmoImpactSnapshotList,
  deserializeImpactFilters,
  serializeImpactFilters,
} from './PmoImpactSnapshotList'
import { PmoImpactSnapshotDetailPanel } from './PmoImpactSnapshotDetailPanel'
import { PmoImpactWhatIfPanel } from './PmoImpactWhatIfPanel'

/**
 * 多项目影响分析工作台容器（v3-ui-next-pmo-domain W8 · tasks 8.1，
 * spec「多项目影响分析工作台」）。
 *
 * - URL query 为快照列表过滤的唯一事实来源（复用旧页 serialize/deserialize
 *   契约，restorable）：状态/严重度/仅过期/项目范围筛选、分页一律经
 *   router.push 写回 URL；过滤条件变更自动回到第 1 页（避免越界空页）；
 * - 视图编排：plan→run 向导 → 快照列表；行选择展开「详情 + What-if」双面板
 *   （详情面板含刷新/导出/跟进草稿/AI 解释动作入口）；
 * - 容器零权限判断（页面壳已按 multi_project_impact:* 门禁）；写类动作门禁在
 *   各面板内部按 multi_project_impact:manage 显隐（RL-06）；
 * - 精确档（precise）剥离氛围光晕降级为纯色工作面（design D7）。
 */
export interface PmoImpactAnalysisWorkspaceProps {
  organizationId: number
}

export function PmoImpactAnalysisWorkspace({ organizationId }: PmoImpactAnalysisWorkspaceProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tier = useImmersionTier()

  const filters = React.useMemo(() => deserializeImpactFilters(searchParams), [searchParams])
  const [selectedSnapshotId, setSelectedSnapshotId] = React.useState<number | null>(null)

  const applyFilters = React.useCallback(
    (next: Partial<MultiProjectImpactListQuery>) => {
      const merged: MultiProjectImpactListQuery = { ...filters, ...next }
      // 过滤条件变更（分页键除外）一律回到第 1 页，避免筛选后停留越界空页。
      const isPageOnly = Object.keys(next).length === 1 && 'page' in next
      if (!isPageOnly) merged.page = undefined
      const qs = serializeImpactFilters(merged)
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [filters, pathname, router],
  )

  const clearFilters = React.useCallback(() => {
    router.push(pathname)
  }, [pathname, router])

  const rootClass = cn(
    'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
    tier === 'precise'
      ? 'bg-[var(--nx-workspace-bg)]'
      : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
  )

  return (
    <div data-imp-workspace className={rootClass}>
      {/* 页头：返回角色首页动线 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            data-imp-back-home
            aria-label="返回角色首页"
            onClick={() => router.push('/next')}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
          <span aria-hidden className="h-6 w-px bg-[var(--nx-border-hairline)]" />
          <div className="min-w-0">
            <h1
              data-imp-title
              className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              多项目影响分析
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
              跨项目传播影响 · 计划→运行快照 · What-if 只读试算 · AI 解释辅助（RL-01）
            </p>
          </div>
        </div>
      </header>

      {/* plan→run 向导（写类动作 manage 门禁在内） */}
      <PmoImpactPlanRunPanel organizationId={organizationId} />

      {/* 快照列表（URL 过滤契约） */}
      <PmoImpactSnapshotList
        organizationId={organizationId}
        filters={filters}
        selectedSnapshotId={selectedSnapshotId}
        onSelectSnapshot={setSelectedSnapshotId}
        onFiltersChange={applyFilters}
        onClearFilters={clearFilters}
      />

      {/* 选中快照：详情 + What-if 双面板（key 保证切换快照时面板内部状态复位） */}
      {selectedSnapshotId !== null ? (
        <div className="grid items-start gap-4 xl:grid-cols-2" data-imp-selection-area>
          <PmoImpactSnapshotDetailPanel
            key={selectedSnapshotId}
            organizationId={organizationId}
            snapshotId={selectedSnapshotId}
            onClose={() => setSelectedSnapshotId(null)}
          />
          <PmoImpactWhatIfPanel
            key={selectedSnapshotId}
            organizationId={organizationId}
            snapshotId={selectedSnapshotId}
          />
        </div>
      ) : null}

      {/* 域徽标：纯装饰，仅工作面页脚提示 */}
      <footer className="flex items-center gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
        <FlaskConical className="h-3 w-3" aria-hidden />
        快照为确定性分析结果；AI 解释与 What-if 均为只读辅助，不改变任何正式数据
      </footer>
    </div>
  )
}

export default PmoImpactAnalysisWorkspace
