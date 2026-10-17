/**
 * 项目章程 Charter 镜头组件（v3-chart-gallery-tier2-org-contract-plans W2 · task 2.3）。
 *
 * 契约与硬边界：
 * 1. Props 严格限定为 `{ projectId: number }`（对齐 `ChartLensComponentProps`）；
 * 2. 消费 `charterApi.get`（只读 GET，RL-01 零写库）；
 * 3. 严格收敛复用 `lens-state-cards.tsx` 三态；
 * 4. Charter 空态专项：新项目无章程（data: null）必须标准空态承接防白屏；
 * 5. 呈现形式适配数据本质（硬边界 8）：暗色控制台结构化文档卡组只读阅览；
 * 6. 缺口字段中性展示「未填写」；
 * 7. 视口插槽解耦：根容器挂载 `data-chart-lens-root="charter"`，主文档区挂载 `data-chart-viewport-slot`；
 * 8. 外部统一注入工具条与导出菜单，镜头内部绝不重复实现汇出按钮；
 * 9. 客观中性原则：DOM 零感性惊恐辞藻。
 */
'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Compass,
  FileText,
  Milestone,
  Shield,
  Target,
} from 'lucide-react'
import { charterApi, charterKeys } from '@/lib/api/charter'
import { buildCharterViewModel, CHARTER_NOT_SET_LABEL } from '@/lib/next/charts/charter-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface CharterChartLensProps {
  projectId: number
}

export function CharterChartLens({ projectId }: CharterChartLensProps) {
  const query = useQuery({
    queryKey: charterKeys.detail(projectId),
    queryFn: () => charterApi.get(projectId),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const rawData = query.data
  const model = React.useMemo(() => buildCharterViewModel(rawData), [rawData])

  const retry = React.useCallback(() => {
    void query.refetch()
  }, [query])

  const isLoading = query.isLoading
  const isError = query.isError && rawData === undefined
  const hasData = model.hasCharter

  return (
    <div data-chart-lens-root="charter" className="flex min-h-[460px] flex-col gap-3">
      {/* 顶部元数据状态栏 */}
      <div
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-2.5 text-xs text-[var(--nx-text-muted)]"
      >
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-4 w-4 text-[var(--nx-accent)]" />
          <span className="font-medium text-[var(--nx-text-primary)]">
            {hasData ? model.title : '项目章程'}
          </span>
          {hasData && (
            <>
              <span
                className={cn(
                  'inline-flex items-center rounded border px-2 py-0.5 font-medium text-[11px]',
                  model.statusBadge.className,
                )}
              >
                {model.statusBadge.label}
              </span>
              <span className="font-mono text-[11px] text-[var(--nx-text-muted)]">
                {model.versionText}
              </span>
            </>
          )}
        </div>

        {hasData && (
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" />
              <span>{model.dateSpan}</span>
            </span>
            {model.approvedAtText && (
              <>
                <span className="text-[var(--nx-border-hairline)]">·</span>
                <span>批准于 {model.approvedAtText}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 三态与主视口 */}
      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载项目章程" chartHeight={460} />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="项目章程加载失败"
          title="项目章程加载失败"
          description="无法获取当前项目的章程契约数据，请稍后重试。"
          onRetry={retry}
        />
      ) : !hasData ? (
        /* 标准空态：未创建章程防白屏 */
        <ChartLensEmptyState
          icon={FileText}
          title="暂无项目章程数据"
          description="当前项目尚未创建项目章程。"
          ariaLabel="项目章程为空"
        />
      ) : (
        /* 结构化文档卡组主视口：挂载 data-chart-viewport-slot */
        <div
          data-chart-viewport-slot
          className="flex flex-col gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-5 shadow-inner"
        >
          {/* 分节 1：项目愿景 (Vision) */}
          <div className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/50 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--nx-text-primary)]">
              <Compass className="h-4 w-4 text-[var(--nx-accent)]" />
              <span>项目愿景 (Project Vision)</span>
            </div>
            <p
              className={cn(
                'text-xs leading-relaxed',
                model.vision === CHARTER_NOT_SET_LABEL
                  ? 'text-[var(--nx-text-muted)] italic'
                  : 'text-[var(--nx-text-secondary)]',
              )}
            >
              {model.vision}
            </p>
          </div>

          {/* 分节 2：业务范围与商业论证 (Scope & Business Case) */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--nx-text-primary)]">
                <FileText className="h-4 w-4 text-[var(--nx-accent)]" />
                <span>业务范围 (Scope)</span>
              </div>
              <p
                className={cn(
                  'text-xs leading-relaxed max-h-48 overflow-y-auto',
                  model.scope === CHARTER_NOT_SET_LABEL
                    ? 'text-[var(--nx-text-muted)] italic'
                    : 'text-[var(--nx-text-secondary)]',
                )}
              >
                {model.scope}
              </p>
            </div>

            <div className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--nx-text-primary)]">
                <Shield className="h-4 w-4 text-[var(--nx-accent)]" />
                <span>商业论证 (Business Case)</span>
              </div>
              <p
                className={cn(
                  'text-xs leading-relaxed max-h-48 overflow-y-auto',
                  model.businessCase === CHARTER_NOT_SET_LABEL
                    ? 'text-[var(--nx-text-muted)] italic'
                    : 'text-[var(--nx-text-secondary)]',
                )}
              >
                {model.businessCase}
              </p>
            </div>
          </div>

          {/* 分节 3：可衡量目标与验收准则 (Objectives & Success Criteria) */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/50 p-4">
              <div className="mb-2.5 flex items-center justify-between text-xs font-semibold text-[var(--nx-text-primary)]">
                <span className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-[var(--nx-accent)]" />
                  <span>阶段性关键目标 (Objectives)</span>
                </span>
                <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {model.objectives.length} 项
                </span>
              </div>
              {model.hasObjectives ? (
                <ul className="space-y-2 text-xs">
                  {model.objectives.map((obj, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-2 text-[var(--nx-text-secondary)]"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--nx-bg-1)] font-mono text-[10px] text-[var(--nx-text-muted)]">
                        {index + 1}
                      </span>
                      <span className="leading-snug">{obj}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs italic text-[var(--nx-text-muted)]">
                  {CHARTER_NOT_SET_LABEL}
                </span>
              )}
            </div>

            <div className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/50 p-4">
              <div className="mb-2.5 flex items-center justify-between text-xs font-semibold text-[var(--nx-text-primary)]">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[var(--nx-accent)]" />
                  <span>成功验收准则 (Success Criteria)</span>
                </span>
                <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {model.successCriteria.length} 项
                </span>
              </div>
              {model.hasSuccessCriteria ? (
                <ul className="space-y-2 text-xs">
                  {model.successCriteria.map((cri, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-2 text-[var(--nx-text-secondary)]"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--nx-bg-1)] font-mono text-[10px] text-[var(--nx-text-muted)]">
                        {index + 1}
                      </span>
                      <span className="leading-snug">{cri}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs italic text-[var(--nx-text-muted)]">
                  {CHARTER_NOT_SET_LABEL}
                </span>
              )}
            </div>
          </div>

          {/* 分节 4：治理与履行总纲 (Governance Overview) */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/30 px-4 py-3 text-xs text-[var(--nx-text-muted)]">
            <div className="flex items-center gap-2 font-mono">
              <Milestone className="h-4 w-4 text-[var(--nx-accent)]" />
              <span>计划周期：{model.dateSpan}</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span>版本归档：{model.versionText}</span>
              <span className="text-[var(--nx-border-hairline)]">·</span>
              <span>状态机：{model.statusBadge.label}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CharterChartLens
