'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ShieldAlert,
  Building2,
  AlertCircle,
  RotateCcw,
  Activity,
  AlertTriangle,
} from 'lucide-react'
import { useStrategyExecutionCockpit } from '@/hooks/use-strategy-execution-cockpit'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import { usePermissions } from '@/hooks/use-permissions'
import {
  parseCockpitUrlFilters,
  serializeCockpitUrlFilters,
} from '@/lib/api/strategy-execution-cockpit'
import { RoleStrategicScrollContainer } from '@/components/next/role-view/RoleStrategicScrollContainer'
import { StrategicScrollHeader } from '@/components/next/role-view/StrategicScrollHeader'
import { StrategicKpiRibbon } from '@/components/next/role-view/StrategicKpiRibbon'
import {
  ObjectiveExecutionMatrix,
  type AiAttributionTarget,
} from '@/components/next/role-view/ObjectiveExecutionMatrix'
import { AttentionCalloutQueue } from '@/components/next/role-view/AttentionCalloutQueue'
import { AiAttributionSummaryDrawer } from '@/components/next/role-view/AiAttributionSummaryDrawer'
import { cn } from '@/lib/utils'
import type { CockpitSortKey } from '@aiproj/types'

/**
 * 战略执行驾驶舱新轨页面（v3-ui-next-batch1-strategy-launch-tasks §1.9 / spec「高管角色访问战略执行驾驶舱呈现纸光长卷」）。
 *
 * 核心特性：
 * 1. 挂载 Role View 方案 B「纸光长卷」总装骨架；
 * 2. RBAC 权限守卫校验 strategy:view；未选组织提示；数据异常提供重试卡；
 * 3. 消费 useStrategyExecutionCockpit 与 useCurrentOrganizationId；
 * 4. URL 筛选参数双向同步（parseCockpitUrlFilters / serializeCockpitUrlFilters）；
 * 5. 恪守 RL-01：全页纯只读，零网络写操作；AI 归因抽屉只读无一键落库。
 */
export default function NextStrategyExecutionCockpitPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const organizationId = useCurrentOrganizationId()
  const { can } = usePermissions()

  // 抽屉状态
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [selectedAttribution, setSelectedAttribution] = React.useState<AiAttributionTarget | null>(
    null,
  )

  // URL 筛选参数同步
  const query = React.useMemo(
    () => parseCockpitUrlFilters(Object.fromEntries(searchParams.entries())),
    [searchParams],
  )

  const applyFilters = React.useCallback(
    (newQuery: Parameters<typeof serializeCockpitUrlFilters>[0]) => {
      const qs = serializeCockpitUrlFilters(newQuery)
      router.replace('/next/strategy-execution-cockpit' + qs, { scroll: false })
    },
    [router],
  )

  const handleResetFilters = React.useCallback(() => {
    applyFilters({})
  }, [applyFilters])

  // RBAC 权限守卫（strategy:view）
  const hasStrategyViewPermission = can('strategy:view')

  const { data, isLoading, isError, refetch } = useStrategyExecutionCockpit(query, {
    enabled: hasStrategyViewPermission && organizationId !== null,
  })

  // 1. 无权访问提示
  if (!hasStrategyViewPermission) {
    return (
      <RoleStrategicScrollContainer title="权限不足提示">
        <div
          data-testid="cockpit-permission-denied"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[rgba(56,52,44,0.15)] bg-[var(--nx-role-surface,#ebe9e1)] p-12 text-center text-[var(--nx-role-text,#38342c)]"
        >
          <ShieldAlert className="h-10 w-10 text-amber-600" />
          <h2 className="text-lg font-bold">无权访问战略执行驾驶舱</h2>
          <p className="max-w-md text-xs text-[var(--nx-role-text,#38342c)]/70">
            需要 strategy:view 权限方可查看战略执行驾驶舱。请联系组织管理员授予战略洞察权限。
          </p>
        </div>
      </RoleStrategicScrollContainer>
    )
  }

  // 2. 未选择组织提示
  if (organizationId === null) {
    return (
      <RoleStrategicScrollContainer title="未选组织提示">
        <div
          data-testid="cockpit-no-organization"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[rgba(56,52,44,0.15)] bg-[var(--nx-role-surface,#ebe9e1)] p-12 text-center text-[var(--nx-role-text,#38342c)]"
        >
          <Building2 className="h-10 w-10 text-[var(--nx-role-accent,#d97706)]" />
          <h2 className="text-lg font-bold">请先选择组织以查看战略执行驾驶舱</h2>
          <p className="max-w-md text-xs text-[var(--nx-role-text,#38342c)]/70">
            战略执行驾驶舱依赖有效组织租户上下文，请在顶部导航切换至目标组织后重试。
          </p>
        </div>
      </RoleStrategicScrollContainer>
    )
  }

  // 3. 骨架加载态
  if (isLoading) {
    return (
      <RoleStrategicScrollContainer title="战略执行驾驶舱正在加载">
        <div data-testid="cockpit-skeleton" role="status" aria-busy="true" className="space-y-6">
          <div className="h-20 w-full animate-pulse rounded-lg bg-[rgba(56,52,44,0.06)]" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-[rgba(56,52,44,0.06)]" />
            ))}
          </div>
          <div className="h-64 w-full animate-pulse rounded-xl bg-[rgba(56,52,44,0.06)]" />
          <div className="h-40 w-full animate-pulse rounded-xl bg-[rgba(56,52,44,0.06)]" />
          <span className="sr-only">正在加载战略执行驾驶舱…</span>
        </div>
      </RoleStrategicScrollContainer>
    )
  }

  // 4. 数据异常与错误重试卡片
  if (isError || !data) {
    return (
      <RoleStrategicScrollContainer title="战略执行驾驶舱加载异常">
        <div
          data-testid="cockpit-error-card"
          role="alert"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-200 bg-[var(--nx-role-surface,#ebe9e1)] p-12 text-center text-[var(--nx-role-text,#38342c)]"
        >
          <AlertCircle className="h-10 w-10 text-rose-600" />
          <h2 className="text-lg font-bold">驾驶舱数据暂不可用，请稍后重试</h2>
          <p className="max-w-md text-xs text-[var(--nx-role-text,#38342c)]/70">
            网络查询或后端服务暂时异常。请检查网络连接后点击重新载入。
          </p>
          <button
            type="button"
            data-testid="cockpit-retry-btn"
            onClick={() => refetch()}
            className={cn(
              'mt-2 inline-flex min-h-[36px] items-center gap-2 rounded-md border px-4 py-2 text-xs font-medium',
              'border-rose-300 bg-[var(--nx-role-bg,#f5f4ef)] text-rose-900',
              'hover:bg-rose-50 active:bg-rose-100',
              'focus-visible:outline-2 focus-visible:outline-rose-600',
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>重新载入</span>
          </button>
        </div>
      </RoleStrategicScrollContainer>
    )
  }

  const { meta, cycleContext, kpis, objectiveRows, attention, warnings } = data

  const handleOpenAttribution = (target: AiAttributionTarget) => {
    setSelectedAttribution(target)
    setDrawerOpen(true)
  }

  const handleSortChange = (key: CockpitSortKey, order: 'asc' | 'desc') => {
    applyFilters({ ...query, sort: key, order })
  }

  return (
    <RoleStrategicScrollContainer title="战略执行驾驶舱">
      {/* 1. 周期导言栏 */}
      <StrategicScrollHeader
        cycleTitle={cycleContext.title}
        calculatedAt={meta.calculatedAt}
        overallStatus={meta.overallStatus}
        onResetFilters={handleResetFilters}
      />

      {/* 降级与警告横幅（若存在） */}
      {meta.overallStatus === 'degraded' && (
        <div
          data-testid="cockpit-degraded-banner"
          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50/70 p-3.5 text-xs text-amber-900"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
          <span>部分来源降级，以下结果可能不完整。</span>
        </div>
      )}

      {warnings && warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs text-amber-800">
          {warnings.map((w, idx) => (
            <li key={idx}>
              [{w.code}]: {w.message}
            </li>
          ))}
        </ul>
      )}

      {/* 2. 战略核心 KPI 丝带 */}
      <StrategicKpiRibbon kpis={kpis} totalObjectives={meta.visibleObjectiveCount} />

      {/* 3. 目标至执行对齐矩阵 */}
      <ObjectiveExecutionMatrix
        rows={objectiveRows}
        sortKey={query.sort}
        sortOrder={query.order}
        onSortChange={handleSortChange}
        onOpenAiAttribution={handleOpenAttribution}
      />

      {/* 4. 战略注意力队列 */}
      <AttentionCalloutQueue
        attentionItems={attention}
        onOpenAiAttribution={handleOpenAttribution}
      />

      {/* 5. 战略全景元信息与新鲜度区 */}
      <footer className="flex flex-wrap items-center justify-between border-t border-[rgba(56,52,44,0.12)] pt-4 text-[11px] text-[var(--nx-role-text,#38342c)]/50">
        <div className="flex items-center gap-2">
          <Activity className="h-3 w-3" />
          <span>指标版本：{meta.metricVersion}</span>
        </div>
        <div>计算时间戳：{meta.calculatedAt}</div>
      </footer>

      {/* 6. AI 战略归因摘要只读抽屉 */}
      <AiAttributionSummaryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        target={selectedAttribution}
      />
    </RoleStrategicScrollContainer>
  )
}
