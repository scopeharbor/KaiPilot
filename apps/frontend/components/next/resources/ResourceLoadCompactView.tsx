'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { ExternalLink, RefreshCw, Users } from 'lucide-react'
import {
  resourcesApi,
  resourceKeys,
  type ResourceLoadResult,
  type TrendResult,
} from '@/lib/api/resources'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  NX_NORMAL_COLOR,
  NX_OVERLOAD_COLOR,
  buildCompactLoadBar,
  buildTeamRows,
  createDefaultLoadWindow,
  formatHours,
  resourceRoleLabel,
  type LoadWindow,
} from '@/lib/next/resources/resource-workbench-adapter'

/**
 * 紧凑团队负荷面板（Compact Load HUD）（v3-ui-next-resource-team-domains W1 ·
 * tasks 1.3，spec「资源负载分析紧凑视图与图表馆联动建议」）。
 *
 * - 消费 `GET /projects/:id/resources/load?view=team`（与图表馆深度镜头同一端点与
 *   30 天滑动窗口，RL-04 数据契约 100% 一致）；
 * - 每位成员一行：身份（头像缩写/姓名/角色）→ 双色负荷条带（额定内
 *   NX_NORMAL_COLOR 冷蓝，>100% 超载段 NX_OVERLOAD_COLOR 警戒红）→
 *   「已分配 / 总额定 · 利用率%」数值与「过载」警示 Chip；
 * - 右上角常驻「进入图表馆深度分析」外链，直达
 *   `/next/projects/:id/charts/resource-load` 深度直方图镜头；
 * - 纯只读（RL-01/RL-06）：无任何写入口；加载/空态/错误重试三态闭环；
 *   精确档（precise）下关闭氛围光晕与呼吸动画。
 */

/** Trend 与 Team 结果类型守卫（与图表馆同源：view=team 返回 ResourceLoadResult）。 */
function isTrendResult(result: ResourceLoadResult | TrendResult): result is TrendResult {
  return Array.isArray((result as TrendResult).days)
}

export interface ResourceLoadCompactViewProps {
  projectId: number
}

export function ResourceLoadCompactView({ projectId }: ResourceLoadCompactViewProps) {
  const router = useRouter()
  const tier = useImmersionTier()

  // 固定 30 天滑动窗口（今天含）——与图表馆资源直方图同一窗口基准。
  const windowRef = React.useRef<LoadWindow>(createDefaultLoadWindow())
  const window = windowRef.current

  const loadQuery = useQuery({
    queryKey: resourceKeys.load(projectId, { from: window.from, to: window.to, view: 'team' }),
    queryFn: () => resourcesApi.load(projectId, { from: window.from, to: window.to, view: 'team' }),
  })

  const teamData =
    loadQuery.data !== undefined && !isTrendResult(loadQuery.data) ? loadQuery.data : undefined
  const rows = React.useMemo(() => (teamData ? buildTeamRows(teamData.resources) : []), [teamData])
  const hasError = loadQuery.isError
  const isEmpty = !loadQuery.isPending && !hasError && rows.length === 0

  return (
    <section
      data-resource-load-compact
      aria-label="团队负荷紧凑排查面板"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] p-3',
        tier === 'precise' ? 'bg-[var(--nx-workspace-bg)]' : 'bg-[var(--nx-workspace-surface)]',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]">
            <Users className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h4 className="text-[13px] font-medium text-[var(--nx-text-primary)]">
              团队负荷 · 紧凑 HUD
            </h4>
            <p
              data-load-compact-window
              className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
            >
              {window.from} ~ {window.to} · {window.days} 天滑动窗口 · 只读
            </p>
          </div>
        </div>
        <button
          type="button"
          data-load-compact-deep-link
          onClick={() => router.push(`/next/projects/${projectId}/charts/resource-load`)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          进入图表馆深度分析
        </button>
      </header>

      {loadQuery.isPending ? (
        <div
          data-load-compact-skeleton
          aria-busy="true"
          aria-label="正在加载团队负荷数据"
          className="flex flex-col gap-2"
        >
          {[0, 1, 2, 3].map((line) => (
            <div
              key={line}
              className="flex h-8 items-center gap-3 rounded-sm border border-[var(--nx-border-hairline)]/60 px-2"
            >
              <div className="h-6 w-6 animate-pulse rounded bg-[var(--nx-bg-1)]" />
              <div className="h-3 w-24 animate-pulse rounded bg-[var(--nx-bg-1)]" />
              <div className="h-2 min-w-0 flex-1 animate-pulse rounded bg-[var(--nx-bg-1)]" />
              <div className="h-3 w-32 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            </div>
          ))}
        </div>
      ) : hasError ? (
        <div
          data-load-compact-error
          role="alert"
          aria-label="团队负荷加载失败"
          className="flex items-center justify-between gap-3 rounded-sm border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-3 py-2.5"
        >
          <p className="text-xs text-[var(--nx-text-secondary)]">
            负荷数据加载失败：
            {loadQuery.error instanceof Error ? loadQuery.error.message : '网络异常'}
          </p>
          <button
            type="button"
            data-load-compact-retry
            onClick={() => void loadQuery.refetch()}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            重试
          </button>
        </div>
      ) : isEmpty ? (
        <div
          data-load-compact-empty
          className="flex flex-col items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] px-4 py-8 text-center"
        >
          <Users className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">当前项目暂无团队成员负荷数据</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            登记在册成员并分配任务工时后，此处将按 30 天滑动窗口呈现额定容量占用与超载警戒。
          </p>
        </div>
      ) : (
        <div data-load-compact-list className="flex flex-col">
          {rows.map((row, index) => {
            const bar = buildCompactLoadBar(row)
            const initials = row.resourceName.trim().slice(0, 1).toUpperCase() || '?'
            return (
              <div
                key={row.resourceId}
                data-load-member={row.resourceId}
                data-load-member-overloaded={bar.overloaded ? 'true' : 'false'}
                className={cn(
                  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2',
                  index > 0 && 'border-t border-[var(--nx-border-hairline)]/60',
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[10px] font-semibold text-[var(--nx-text-secondary)]">
                  {initials}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      data-load-member-name
                      className="truncate text-xs font-medium text-[var(--nx-text-primary)]"
                    >
                      {row.resourceName}
                    </span>
                    <span className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1.5 py-px text-[10px] text-[var(--nx-text-muted)]">
                      {resourceRoleLabel(row.role)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div
                      data-load-bar
                      aria-label={`${row.resourceName} 负荷条带`}
                      className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.14)]"
                    >
                      <div
                        data-load-bar-normal
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${bar.normalPercent}%`, backgroundColor: NX_NORMAL_COLOR }}
                      />
                      {bar.overloadPercent > 0 ? (
                        <div
                          data-load-bar-overload
                          className="absolute inset-y-0 rounded-full"
                          style={{
                            left: `${bar.normalPercent}%`,
                            width: `${bar.overloadPercent}%`,
                            backgroundColor: NX_OVERLOAD_COLOR,
                          }}
                        />
                      ) : null}
                    </div>
                    <span
                      data-load-bar-metrics
                      className="shrink-0 font-mono text-[10px] text-[var(--nx-text-secondary)]"
                    >
                      {formatHours(bar.totalAllocatedHours)}h /{' '}
                      {formatHours(bar.totalCapacityHours)}h
                    </span>
                    <span
                      data-load-bar-percent
                      className={cn(
                        'w-14 shrink-0 text-right font-mono text-[11px]',
                        bar.overloaded
                          ? 'text-[var(--nx-status-danger)]'
                          : 'text-[var(--nx-text-secondary)]',
                      )}
                    >
                      {formatHours(bar.utilizationPercent)}%
                    </span>
                  </div>
                </div>
                <div className="flex w-16 shrink-0 flex-col items-end gap-1">
                  {bar.overloaded ? (
                    <span
                      data-load-badge="overload"
                      className="inline-flex items-center rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--nx-status-danger)]"
                    >
                      过载
                    </span>
                  ) : bar.idle ? (
                    <span
                      data-load-badge="idle"
                      className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
                    >
                      未分配
                    </span>
                  ) : (
                    <span
                      data-load-badge="normal"
                      className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
                    >
                      正常
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default ResourceLoadCompactView
