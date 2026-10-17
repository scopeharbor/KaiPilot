'use client'

import * as React from 'react'
import { Target } from 'lucide-react'
import { useOkrCycles, useOkrTree } from '@/hooks/use-okr'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import type { OkrScope, OkrStatus, OkrTreeQuery } from '@aiproj/types'
import {
  OKR_SCOPE_FILTER_OPTIONS,
  OKR_STATUS_FILTER_OPTIONS,
  okrCycleListOf,
  okrTreeListOf,
  okrTreeMetaOf,
} from '@/lib/next/org-okr/org-okr-adapter'
import { OkrCyclePicker } from './OkrCyclePicker'
import { OkrTreeTable } from './OkrTreeTable'

/**
 * OKR 层级管理工作台（v3-ui-next-org-portfolio-domains W2 · tasks 2.3，
 * spec「OKR 层级管理与达成仪表盘（幽灵守卫修复）」）。
 *
 * - 数据 100% 复用既有 `useOkrCycles` / `useOkrTree`（GET /okrs/cycles、/okrs/tree，
 *   RL-04 缓存同源）；组织 ID 由页面装配层从有效租户上下文注入，本组件零权限判断；
 * - 周期/范围/状态筛选为纯本地 state，联动 tree 查询参数（cycleId/scope/status/
 *   depth=5 白名单），全部只读重查（RL-01：筛选交互零写请求）；
 * - 目标树经 OkrTreeTable 高密度呈现：O→KR 缩进、负责人、进度条带（双通道）、
 *   状态/范围徽标、meta 警告与「数据陈旧」中性提示；
 * - 三态（骨架/空树/错误重试）由 OkrTreeTable 闭环，页面根随精确档剥离氛围光晕。
 */
export interface OkrWorkbenchProps {
  organizationId: number
}

export function OkrWorkbench({ organizationId }: OkrWorkbenchProps) {
  const tier = useImmersionTier()
  const [selectedCycleId, setSelectedCycleId] = React.useState<number | undefined>()
  const [scopeFilter, setScopeFilter] = React.useState<OkrScope | undefined>()
  const [statusFilter, setStatusFilter] = React.useState<OkrStatus | undefined>()

  const treeQuery: OkrTreeQuery = {
    cycleId: selectedCycleId,
    scope: scopeFilter,
    status: statusFilter,
    depth: 5,
  }

  const cyclesQuery = useOkrCycles(organizationId, {})
  const treeQueryResult = useOkrTree(organizationId, treeQuery)

  const cycles = okrCycleListOf(cyclesQuery.data)
  const nodes = okrTreeListOf(treeQueryResult.data)
  // meta（totalNodes/warnings/truncated）仅在数据层信封形态可达；纯数组形态下
  // 自然回落行内统计派生（OkrTreeTable 已防御）。
  const treeMeta = okrTreeMetaOf(treeQueryResult.data)
  const warnings = treeMeta?.warnings ?? []
  const treeLoading = treeQueryResult.isLoading || treeQueryResult.isPending
  const error = treeQueryResult.error ?? cyclesQuery.error
  const errorMessage = error ? ((error as { message?: string }).message ?? '未知错误') : null

  const retry = () => {
    void treeQueryResult.refetch()
    void cyclesQuery.refetch()
  }

  const selectClass =
    'h-8 min-w-32 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none'

  return (
    <div
      data-okr-workbench
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Target className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1
              data-okr-workbench-title
              className="text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              OKR 层级管理
            </h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              组织目标树：目标（O）→ 关键结果（KR）→ 子目标对齐 · 进度与信心只读呈现
            </p>
          </div>
        </div>
      </header>

      {/* 周期 + 范围/状态筛选条（纯只读重查） */}
      <div
        data-okr-filter-bar
        className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
      >
        <OkrCyclePicker
          cycles={cycles}
          value={selectedCycleId}
          onChange={setSelectedCycleId}
          loading={cyclesQuery.isLoading}
        />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--nx-text-muted)]">范围</span>
          <select
            data-okr-scope-filter
            aria-label="按范围筛选 OKR"
            className={selectClass}
            value={scopeFilter ?? 'all'}
            onChange={(event) => {
              const raw = event.target.value
              setScopeFilter((raw === 'all' ? undefined : raw) as OkrScope | undefined)
            }}
          >
            {OKR_SCOPE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--nx-text-muted)]">状态</span>
          <select
            data-okr-status-filter
            aria-label="按状态筛选 OKR"
            className={selectClass}
            value={statusFilter ?? 'all'}
            onChange={(event) => {
              const raw = event.target.value
              setStatusFilter((raw === 'all' ? undefined : raw) as OkrStatus | undefined)
            }}
          >
            {OKR_STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {cycles.length === 0 && !cyclesQuery.isLoading ? (
          <p className="text-[11px] text-[var(--nx-text-muted)]" data-okr-no-cycles-hint>
            暂无 OKR 周期记录
          </p>
        ) : null}
      </div>

      {/* 目标树（含 meta 警告 / 陈旧提示 / 三态） */}
      <OkrTreeTable
        nodes={nodes}
        warnings={warnings}
        meta={
          treeMeta
            ? {
                totalNodes: treeMeta.totalNodes,
                maxDepth: treeMeta.maxDepth,
                truncated: treeMeta.truncated,
              }
            : undefined
        }
        isLoading={treeLoading}
        isError={treeQueryResult.isError || cyclesQuery.isError}
        errorMessage={errorMessage}
        onRetry={retry}
      />
    </div>
  )
}

export default OkrWorkbench
