'use client'

// 健康仪表盘（v3-okr-cascade-and-alignment §5.4 补充）。
// 展示所有目标的健康状态概览。

import type { OkrAlignmentHealth, OkrScope, OkrHealthLevel } from '@aiproj/types'
import { cn } from '@/lib/utils'

/**
 * 契约里并没有 `OkrHealthResult`，健康列表返回的是 `OkrAlignmentHealth`；
 * 但本视图还要展示目标标题，而标题不在健康契约内，故在视图层附加为可选字段。
 */
export type HealthDashboardItem = OkrAlignmentHealth & { objectiveTitle?: string }

export interface HealthDashboardProps {
  organizationId: number
  items: HealthDashboardItem[]
  loading: boolean
  selectedCycleId?: number
  scopeFilter?: OkrScope
}

const healthLevelLabels: Record<OkrHealthLevel | string, string> = {
  healthy: '健康',
  needs_attention: '需关注',
  at_risk: '风险',
  unavailable: '不可用',
}

const healthLevelColors: Record<string, string> = {
  healthy: 'bg-green-100 text-green-700 border-green-300',
  needs_attention: 'bg-amber-100 text-amber-700 border-amber-300',
  at_risk: 'bg-red-100 text-red-700 border-red-300',
  unavailable: 'bg-gray-100 text-gray-500 border-gray-200',
}

export function HealthDashboard({ items, loading, selectedCycleId }: HealthDashboardProps) {
  // ── 加载态 ──
  if (loading) {
    return (
      <div
        className="text-center py-8 text-muted-foreground"
        data-testid="health-dashboard-loading"
      >
        加载健康数据...
      </div>
    )
  }

  // ── 空态 ──
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid="health-dashboard-empty">
        {selectedCycleId
          ? '暂无健康数据。请确保周期中存在目标。'
          : '请先选择一个 OKR 周期以查看健康仪表盘。'}
      </div>
    )
  }

  // ── 汇总统计 ──
  const summary = {
    total: items.length,
    healthy: items.filter((i) => i.level === 'healthy').length,
    needsAttention: items.filter((i) => i.level === 'needs_attention').length,
    atRisk: items.filter((i) => i.level === 'at_risk').length,
    unavailable: items.filter((i) => i.level === 'unavailable').length,
  }

  return (
    <div className="space-y-4" data-testid="health-dashboard">
      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="border rounded p-3 text-center">
          <div className="text-2xl font-bold">{summary.total}</div>
          <div className="text-xs text-muted-foreground">总计</div>
        </div>
        <div className="border border-green-300 bg-green-50 rounded p-3 text-center">
          <div className="text-2xl font-bold text-green-700">{summary.healthy}</div>
          <div className="text-xs text-green-600">健康</div>
        </div>
        <div className="border border-amber-300 bg-amber-50 rounded p-3 text-center">
          <div className="text-2xl font-bold text-amber-700">{summary.needsAttention}</div>
          <div className="text-xs text-amber-600">需关注</div>
        </div>
        <div className="border border-red-300 bg-red-50 rounded p-3 text-center">
          <div className="text-2xl font-bold text-red-700">{summary.atRisk}</div>
          <div className="text-xs text-red-600">风险</div>
        </div>
        <div className="border border-gray-200 bg-gray-50 rounded p-3 text-center">
          <div className="text-2xl font-bold text-gray-500">{summary.unavailable}</div>
          <div className="text-xs text-gray-400">不可用</div>
        </div>
      </div>

      {/* 详细列表 */}
      <div className="border rounded divide-y">
        {items.map((item) => (
          <div
            key={item.objectiveId}
            className={cn('p-3 flex items-start gap-3 border-l-4', {
              'border-l-green-400': item.level === 'healthy',
              'border-l-amber-400': item.level === 'needs_attention',
              'border-l-red-400': item.level === 'at_risk',
              'border-l-gray-300': item.level === 'unavailable',
            })}
          >
            {/* 健康等级徽标 */}
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded shrink-0',
                healthLevelColors[item.level] ?? 'bg-gray-100',
              )}
            >
              {healthLevelLabels[item.level] ?? item.level}
            </span>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{item.objectiveTitle}</div>
              <div className="text-xs text-muted-foreground">
                评分: {item.score}/100
                {item.metricVersion && ` · 版本: ${item.metricVersion}`}
              </div>

              {/* 警告 */}
              {item.warnings && item.warnings.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {/* OkrWarning 恒为对象，无需再判字符串 */}
                  {item.warnings.map((w, i) => (
                    <div key={i} className="text-xs text-amber-600">
                      ⚠ {w.message}
                    </div>
                  ))}
                </div>
              )}

              {/* 元数据 */}
              {item.freshness && (
                // OkrFreshness 只有 source / lastUpdatedAt / stale 三个字段，
                // 没有 status 与 ageDays。
                <div className="text-xs text-muted-foreground mt-1">
                  证据新鲜度: {item.freshness.stale ? '已过期' : '新鲜'}
                  {item.freshness.lastUpdatedAt &&
                    `（更新于 ${new Date(item.freshness.lastUpdatedAt).toLocaleDateString()}）`}
                </div>
              )}
            </div>

            {/* 分数 */}
            <div
              className={cn('text-lg font-bold shrink-0', {
                'text-green-600': item.score >= 80,
                'text-amber-600': item.score >= 50 && item.score < 80,
                'text-red-600': item.score < 50,
              })}
            >
              {item.score}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
