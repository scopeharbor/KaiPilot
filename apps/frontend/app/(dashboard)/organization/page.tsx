'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  useOrganizationDashboard,
  useCurrentOrganizationId,
} from '@/hooks/use-organization-dashboard'
import { useCurrentLayout } from '@/hooks/use-organization-dashboard-layout'
import { usePermissions } from '@/hooks/use-permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { OrganizationDashboardLayoutEditor } from '@/components/organization/organization-dashboard-layout-editor'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Building2,
  Clock,
  EyeOff,
  FolderKanban,
  LayoutDashboard,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ORGANIZATION_ATTENTION_REASON_LABELS,
  ORGANIZATION_HEALTH_LABELS,
  ORGANIZATION_METRIC_LABELS,
  ORGANIZATION_PROJECT_STATUS_LABELS,
  ORGANIZATION_REMINDER_LABELS,
  ORGANIZATION_SOURCE_LABELS,
  formatOrganizationMetricValue,
  formatOrganizationWarning,
  formatRelativeTime,
  isEmptyOrganizationDashboard,
  isMetricRedacted,
  selectKpiStrip,
  staleSources,
} from '@/lib/organization-dashboard-ui'
import type { OrganizationDashboardTarget } from '@aiproj/types'

/**
 * 组织总览工作台（v3-organization-dashboard §5.2–5.6）。
 *
 * 路由：`/organization`（当前组织，组织 ID 来自 JWT claims）
 * 首屏：组织身份 + KPI 条 + 状态分布 + 待关注项目 + 成员/资源概览 + 风险提醒 + 活动流 + PMO 入口。
 * 定位是高频扫描的运营工作台，不做营销式 landing page；
 * 所有跳转只使用后端下发的授权 target descriptor，真实详情端点仍二次授权。
 */
export default function OrganizationDashboardPage() {
  const { canAny } = usePermissions()
  const hasAccess = canAny(['org:view', 'portfolio:view'])
  const { data: summary, isLoading, error } = useOrganizationDashboard()
  const { data: layoutData } = useCurrentLayout()
  const [editingLayout, setEditingLayout] = useState(false)

  // 当前会话没有组织（如未加入任何组织的个人账号）：统一渲染引导，
  // 不发请求（hook 内 enabled 已暂停），与 okrs/okr-alignment 的幽灵参数修复一致。
  const organizationId = useCurrentOrganizationId()

  // ── 布局渲染：消费当前布局配置（task 5.5） ──
  const activeLayout = layoutData?.layout
  const layoutWarnings = layoutData?.warnings ?? []

  if (organizationId === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert className="max-w-md">请先选择组织</Alert>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有组织总览访问权限。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载组织总览失败，请稍后重试。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (isLoading || !summary) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_value, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const kpiStrip = selectKpiStrip(summary)
  const stale = staleSources(summary)
  const isEmpty = isEmptyOrganizationDashboard(summary)

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* 组织身份 + 计算时间 */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Building2 className="h-7 w-7 shrink-0 text-teal-600" aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-gray-800 sm:text-2xl">
              {summary.organization.name || '当前组织'}
            </h1>
            <p className="truncate text-xs text-gray-500 sm:text-sm">
              {summary.organization.slug ? `@${summary.organization.slug} · ` : ''}
              可见项目 {summary.meta.visibleProjectCount} 个 · 更新于{' '}
              {formatRelativeTime(summary.meta.calculatedAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingLayout(!editingLayout)}
            aria-label={editingLayout ? '退出布局编辑' : '编辑布局'}
          >
            <LayoutDashboard className="mr-1 h-3.5 w-3.5" />
            {editingLayout ? '退出编辑' : '编辑布局'}
          </Button>
          {stale.length > 0 ? (
            <Badge variant="warning" className="whitespace-nowrap">
              <Clock className="mr-1 h-3 w-3" aria-hidden />
              {stale.length} 个数据源已过期
            </Badge>
          ) : null}
          {summary.warnings.slice(0, 3).map((warning, index) => (
            <Badge key={`${warning.code}-${index}`} variant="neutral" className="whitespace-nowrap">
              {formatOrganizationWarning(warning)}
            </Badge>
          ))}
        </div>
      </header>

      {/* 布局编辑入口（task 5.5 集成点） */}
      {editingLayout ? (
        <section aria-label="布局编辑面板">
          <OrganizationDashboardLayoutEditor
            currentLayout={activeLayout ?? null}
            onClose={() => setEditingLayout(false)}
          />
        </section>
      ) : null}

      {/* 布局 warning badges */}
      {!editingLayout && layoutWarnings.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {layoutWarnings.map((warning, index) => (
            <Badge
              key={`${warning.code}-${index}`}
              variant="warning"
              className="whitespace-nowrap text-xs"
            >
              {warning.message}
            </Badge>
          ))}
        </div>
      )}

      {/* KPI 条 */}
      <section aria-label="组织关键指标">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpiStrip.map((metric) => (
            <StatCard
              key={metric.key}
              label={ORGANIZATION_METRIC_LABELS[metric.key] ?? metric.key}
              value={formatOrganizationMetricValue(metric)}
              hint={isMetricRedacted(metric) ? '权限受限' : undefined}
              className={cn(isMetricRedacted(metric) && 'opacity-70')}
            />
          ))}
        </div>
      </section>

      {isEmpty ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FolderKanban}
              title="当前组织还没有可见项目"
              description="创建第一个项目后，这里会显示组织级的运行概览、待关注项目与风险提醒。"
            />
          </CardContent>
        </Card>
      ) : null}

      {/* 状态分布 + 待关注项目 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">项目状态分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.statusDistribution.length === 0 ? (
              <p className="text-sm text-gray-500">暂无数据</p>
            ) : (
              summary.statusDistribution.map((slice) => (
                <div key={slice.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-gray-700">
                      {ORGANIZATION_PROJECT_STATUS_LABELS[slice.key] ?? slice.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-gray-500">
                      {slice.count} · {slice.percent}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{ width: `${Math.max(0, Math.min(100, slice.percent))}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">待关注项目</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.attentionProjects.length === 0 ? (
              <p className="text-sm text-gray-500">当前没有需要关注的项目</p>
            ) : (
              summary.attentionProjects.map((item) => (
                <div
                  key={item.projectId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <SafeTargetLink target={item.target} className="min-w-0 truncate font-medium">
                        {item.projectName}
                      </SafeTargetLink>
                      <Badge variant="neutral" className="shrink-0">
                        {ORGANIZATION_HEALTH_LABELS[item.healthStatus] ?? item.healthStatus}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {item.reasons.map((reason) => (
                        <Badge key={reason} variant="warning" className="whitespace-nowrap text-xs">
                          {ORGANIZATION_ATTENTION_REASON_LABELS[reason] ?? reason}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-gray-500">
                    <span className="tabular-nums">进度 {item.progressPercent}%</span>
                    {item.overdueTaskCount !== null ? (
                      <span className="tabular-nums">逾期任务 {item.overdueTaskCount}</span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* 成员 / 资源概览 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" aria-hidden />
              成员概览
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary.memberOverview.forbidden ? (
              <RedactedNotice text="成员数据因权限不可见" />
            ) : !summary.memberOverview.available ? (
              <p className="text-sm text-gray-500">成员数据暂不可用</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="text-gray-700">
                    总数{' '}
                    <strong className="tabular-nums">{summary.memberOverview.totalMembers}</strong>
                  </span>
                  <span className="text-gray-700">
                    活跃{' '}
                    <strong className="tabular-nums">{summary.memberOverview.activeMembers}</strong>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {summary.memberOverview.roleDistribution.map((slice) => (
                    <Badge key={slice.key} variant="neutral" className="whitespace-nowrap text-xs">
                      {slice.label} {slice.count}
                    </Badge>
                  ))}
                </div>
                {summary.memberOverview.target ? (
                  <SafeTargetLink
                    target={summary.memberOverview.target}
                    className="inline-flex items-center gap-1 text-sm text-teal-600"
                  >
                    查看成员 <ArrowRight className="h-3 w-3" aria-hidden />
                  </SafeTargetLink>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" aria-hidden />
              资源概览
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary.resourceOverview.forbidden ? (
              <RedactedNotice text="资源数据因权限不可见" />
            ) : !summary.resourceOverview.available ? (
              <p className="text-sm text-gray-500">资源数据暂不可用</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-sm text-gray-700">
                  <span>
                    已分配项目{' '}
                    <strong className="tabular-nums">
                      {summary.resourceOverview.allocatedProjectCount}
                    </strong>
                  </span>
                  <span>
                    超载资源{' '}
                    <strong className="tabular-nums">
                      {summary.resourceOverview.overloadedResourceCount}
                    </strong>
                  </span>
                </div>
                {summary.resourceOverview.target ? (
                  <SafeTargetLink
                    target={summary.resourceOverview.target}
                    className="inline-flex items-center gap-1 text-sm text-teal-600"
                  >
                    查看资源 <ArrowRight className="h-3 w-3" aria-hidden />
                  </SafeTargetLink>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 风险 / 延期提醒 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            风险与延期提醒
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summary.riskReminders.length === 0 ? (
            <p className="text-sm text-gray-500">暂无提醒</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {summary.riskReminders.map((reminder) => (
                <div
                  key={reminder.code}
                  className="min-w-0 rounded-[var(--radius-md)] border border-border p-3"
                >
                  <div className="truncate text-sm text-gray-500">
                    {ORGANIZATION_REMINDER_LABELS[reminder.code] ?? reminder.label}
                  </div>
                  <div className="text-xl font-semibold tabular-nums text-gray-800">
                    {reminder.count === null ? '--' : reminder.count}
                  </div>
                  {reminder.count === null ? (
                    <div className="text-xs text-gray-500">权限受限</div>
                  ) : reminder.target ? (
                    <SafeTargetLink target={reminder.target} className="text-xs text-teal-600">
                      查看详情
                    </SafeTargetLink>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 活动流 + PMO 入口 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">近期活动</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.recentActivity.length === 0 ? (
              <p className="text-sm text-gray-500">暂无可见活动</p>
            ) : (
              summary.recentActivity.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="neutral" className="shrink-0 text-xs">
                      {item.entityType ?? '事件'}
                    </Badge>
                    <span className="min-w-0 truncate text-sm text-gray-700">{item.action}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
                    <span>{formatRelativeTime(item.occurredAt)}</span>
                    {item.target ? (
                      <SafeTargetLink target={item.target} className="text-teal-600">
                        打开
                      </SafeTargetLink>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">PMO 组合分析</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.pmoEntry.forbidden ? (
              <RedactedNotice text="无 PMO 组合查看权限" />
            ) : !summary.pmoEntry.available ? (
              <p className="text-sm text-gray-500">PMO 组合摘要暂不可用</p>
            ) : (
              <>
                <div className="space-y-1 text-sm text-gray-700">
                  <div className="flex justify-between gap-2">
                    <span>组合项目</span>
                    <span className="tabular-nums">
                      {summary.pmoEntry.summary?.totalProjects ?? '--'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>风险项目</span>
                    <span className="tabular-nums">
                      {summary.pmoEntry.summary?.atRiskProjects ?? '--'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>平均进度</span>
                    <span className="tabular-nums">
                      {summary.pmoEntry.summary?.overallProgressAvg ?? '--'}%
                    </span>
                  </div>
                </div>
                {summary.pmoEntry.targets.map((target) => (
                  <SafeTargetLink
                    key={target.href}
                    target={target}
                    className="inline-flex items-center gap-1 text-sm text-teal-600"
                  >
                    进入 PMO 工作台 <ArrowRight className="h-3 w-3" aria-hidden />
                  </SafeTargetLink>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 数据来源新鲜度 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">数据来源新鲜度</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {summary.sourceFreshness.map((item) => (
              <Badge
                key={item.source}
                variant={item.isStale ? 'warning' : 'neutral'}
                className="whitespace-nowrap text-xs"
              >
                {ORGANIZATION_SOURCE_LABELS[item.source] ?? item.source} ·{' '}
                {item.status === 'forbidden'
                  ? '权限受限'
                  : item.status === 'unavailable'
                    ? '不可用'
                    : formatRelativeTime(item.lastUpdatedAt)}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** 权限受限占位——只说明不可见，不显示任何隐藏计数或名称。 */
function RedactedNotice({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-gray-500">
      <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
      {text}
    </p>
  )
}

/**
 * 安全跳转：只渲染后端标记 `authorized === true` 的 target；
 * 未授权或缺失 target 时降级为纯文本，绝不自行拼接链接。
 */
function SafeTargetLink({
  target,
  className,
  children,
}: {
  target: OrganizationDashboardTarget | null
  className?: string
  children: React.ReactNode
}) {
  if (!target || !target.authorized) {
    return <span className={className}>{children}</span>
  }
  return (
    <Link href={target.href} className={cn('hover:underline', className)}>
      {children}
    </Link>
  )
}
