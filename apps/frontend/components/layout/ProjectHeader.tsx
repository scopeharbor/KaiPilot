'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  projectDashboardApi,
  projectKeys,
  projectsApi,
  type ProjectDashboard,
} from '@/lib/api/projects'
import { getMetric } from '@/lib/dashboard-metrics'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import PermissionGuard from '@/components/PermissionGuard'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatCard } from '@/components/ui/StatCard'
import { ProjectTabs } from '@/components/layout/ProjectTabs'
import { activityLabel } from '@/lib/audit-labels'
import {
  DASHBOARD_METRIC_KEYS,
  getParameter,
  type ContradictionDashboardSummary,
  type ContradictionSeverity,
} from '@aiproj/types'

/**
 * 共享项目头（build-app-shell-layout / spec project-view-tabs 「共享项目头」场景）：
 *
 * - 挂 `projects/[id]/layout.tsx`——在 6 视图 Tab 之上；切换 Tab 时保持不变（不整页重载）。
 * - 内容：项目名/描述/操作 + 关键统计卡片 + 最近活动摘要 + ProjectTabs。
 * - 承载了原 `projects/[id]/page.tsx` 的所有信息（改造前唯一入口），页面移到 layout 后由所有视图共用。
 */
export function ProjectHeader() {
  const params = useParams()
  const id = Number(params.id)
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }
  return (
    <PermissionGuard
      require="project:view"
      fallback={<Alert className="my-8">无权访问该项目</Alert>}
    >
      <ProjectHeaderContent id={id} />
    </PermissionGuard>
  )
}

function ProjectHeaderContent({ id }: { id: number }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const project = useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => projectsApi.get(id),
  })
  const dashboard = useQuery({
    queryKey: projectKeys.dashboard(id),
    queryFn: () => projectDashboardApi.get(id),
  })

  const archive = useMutation({
    mutationFn: () => projectsApi.archive(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) }),
  })
  const restore = useMutation({
    mutationFn: () => projectsApi.restore(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) }),
  })
  const remove = useMutation({
    mutationFn: () => projectsApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
      router.push('/projects')
    },
  })

  if (project.isLoading) {
    return (
      <div className="space-y-6 py-8" aria-label="正在加载项目">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      </div>
    )
  }
  if (project.isError || !project.data) {
    return <Alert className="my-8" variant="danger" title="项目加载失败" />
  }

  const dashboardStats = dashboard.data?.stats
  const metrics = dashboard.data?.metrics
  const warnings = dashboard.data?.warnings
  // 健康度优先取 Dashboard 派生的 HEALTH_STATUS metric（读取期派生），回退项目存储值。
  const healthMetric = getMetric(metrics, DASHBOARD_METRIC_KEYS.HEALTH_STATUS)?.value
  const health = healthLabel(
    (typeof healthMetric === 'string' ? healthMetric : null) ?? project.data.healthStatus,
  )
  const taskTotalMetric = scalarMetricValue(getMetric(metrics, DASHBOARD_METRIC_KEYS.TASK_TOTAL))
  const milestoneTotalMetric = scalarMetricValue(
    getMetric(metrics, DASHBOARD_METRIC_KEYS.MILESTONE_TOTAL),
  )
  const memberCountMetric = scalarMetricValue(
    getMetric(metrics, DASHBOARD_METRIC_KEYS.MEMBER_COUNT),
  )

  const taskCount =
    taskTotalMetric ??
    (dashboardStats?.taskStatusDistribution
      ? sumMap(dashboardStats.taskStatusDistribution)
      : (project.data.stats?.taskCount ?? 0))
  const milestoneCount =
    milestoneTotalMetric ??
    (dashboardStats?.milestoneStatusDistribution
      ? sumMap(dashboardStats.milestoneStatusDistribution)
      : (project.data.stats?.milestoneCount ?? 0))
  const memberCount =
    memberCountMetric ?? dashboardStats?.memberCount ?? project.data.stats?.memberCount ?? 0
  const remainingDays =
    getMetric(metrics, DASHBOARD_METRIC_KEYS.REMAINING_DAYS)?.value ??
    dashboardStats?.remainingDays ??
    '—'

  return (
    <div className="space-y-6 py-8">
      <Card variant="outlined">
        <CardContent className="flex flex-col gap-5 pt-[var(--card-pad)] md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="font-mono text-xs text-gray-500">
              {project.data.code || '未设置项目编码'}
            </p>
            <h1 className="text-2xl font-semibold text-gray-800 text-balance">
              {project.data.name}
            </h1>
            <p className="max-w-[70ch] text-sm text-gray-600 text-pretty">
              {project.data.description || '尚未填写描述'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <PermissionGuard require="project:update">
              {project.data.status === 'archived' ? (
                <Button
                  variant="secondary"
                  loading={restore.isPending}
                  onClick={() => restore.mutate()}
                >
                  恢复项目
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  loading={archive.isPending}
                  onClick={() => archive.mutate()}
                >
                  归档项目
                </Button>
              )}
            </PermissionGuard>
            <PermissionGuard require="project:delete">
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => {
                  if (window.confirm('确认删除该项目？')) remove.mutate()
                }}
              >
                删除项目
              </Button>
            </PermissionGuard>
          </div>
        </CardContent>
      </Card>

      {warnings && warnings.length > 0 ? (
        <div className="space-y-2" aria-label="指标警告">
          {warnings.map((w, i) => (
            <Alert key={i} variant="warning" className="text-sm">
              {w.message}
            </Alert>
          ))}
        </div>
      ) : null}

      <section
        aria-label="项目关键指标"
        className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6"
      >
        <StatCard label="进度" value={`${project.data.progressPercent}%`} />
        <StatCard label="健康度" value={health} hint="状态以文字显示" />
        <StatCard label="成员" value={memberCount} />
        <StatCard label="任务" value={taskCount} />
        <StatCard label="里程碑" value={milestoneCount} />
        <StatCard label="剩余天数" value={remainingDays} />
      </section>

      <ContradictionSummaryCard
        projectId={id}
        summary={dashboard.data?.contradictionSummary}
        loading={dashboard.isLoading}
      />

      <TrizInnovationWorkbenchSummaryCard
        projectId={id}
        summary={dashboard.data?.trizInnovationWorkbenchSummary}
        loading={dashboard.isLoading}
      />

      <Card variant="outlined">
        <CardContent className="pt-[var(--card-pad)]">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-800">最近活动</h2>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                className="text-sm font-medium text-primary-600 hover:underline"
                href={`/projects/${id}/tasks`}
              >
                任务批量管理
              </Link>
              <Link
                className="text-sm font-medium text-primary-600 hover:underline"
                href={`/projects/${id}/members`}
              >
                成员管理
              </Link>
              <Link
                className="text-sm font-medium text-primary-600 hover:underline"
                href={`/projects/${id}/change-requests`}
              >
                变更请求
              </Link>
              <PermissionGuard require="triz_decision:view" fallback={null}>
                <Link
                  className="text-sm font-medium text-primary-600 hover:underline"
                  href={`/projects/${id}/triz-decision-center`}
                >
                  TRIZ 决策中心
                </Link>
              </PermissionGuard>
              <PermissionGuard require="triz_resource_analyzer:view" fallback={null}>
                <Link
                  className="text-sm font-medium text-primary-600 hover:underline"
                  href={`/projects/${id}/triz-resource-analyzer`}
                >
                  TRIZ 资源分析
                </Link>
              </PermissionGuard>
              <PermissionGuard require="triz_evolution_trend_analysis:view" fallback={null}>
                <Link
                  className="text-sm font-medium text-primary-600 hover:underline"
                  href={`/projects/${id}/triz-evolution-trend`}
                >
                  进化趋势
                </Link>
              </PermissionGuard>
              <PermissionGuard require="triz_function_analysis:view" fallback={null}>
                <Link
                  className="text-sm font-medium text-primary-600 hover:underline"
                  href={`/projects/${id}/triz/function-analysis`}
                >
                  功能分析图
                </Link>
              </PermissionGuard>
              <PermissionGuard require="triz_skill_layer:view" fallback={null}>
                <Link
                  className="text-sm font-medium text-primary-600 hover:underline"
                  href={`/projects/${id}/triz-skill-layer`}
                >
                  TRIZ Skill Layer
                </Link>
              </PermissionGuard>
              <PermissionGuard require="triz_pm_phase_integration:view" fallback={null}>
                <Link
                  className="text-sm font-medium text-primary-600 hover:underline"
                  href={`/projects/${id}/triz-pm-phase`}
                >
                  TRIZ-PM 阶段整合
                </Link>
              </PermissionGuard>
              <PermissionGuard require="triz_assistant:view" fallback={null}>
                <Link
                  className="text-sm font-medium text-primary-600 hover:underline"
                  href={`/projects/${id}/triz/assistant`}
                >
                  AI-TRIZ 助手
                </Link>
              </PermissionGuard>
              <Link
                className="text-sm font-medium text-primary-600 hover:underline"
                href={`/projects/${id}/settings`}
              >
                项目设置
              </Link>
            </div>
          </div>
          <ul className="mt-4 max-h-80 divide-y divide-border overflow-y-auto pr-1 [scrollbar-color:var(--color-gray-300)_transparent]">
            {dashboard.data?.recentActivity.map(
              (item: ProjectDashboard['recentActivity'][number]) => (
                <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <article className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <strong className="font-medium text-gray-800">
                      {activityLabel(item.event, item.action)}
                    </strong>
                    <time className="text-xs text-gray-500" dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                    </time>
                  </article>
                </li>
              ),
            )}
            {dashboard.data && dashboard.data.recentActivity.length === 0 ? (
              <li className="py-4 text-sm text-gray-500">暂无活动</li>
            ) : null}
            {dashboard.isLoading ? (
              <li className="py-3">
                <Skeleton className="h-5 w-full" />
              </li>
            ) : null}
          </ul>
        </CardContent>
      </Card>

      <ProjectTabs />
    </div>
  )
}

export function TrizInnovationWorkbenchSummaryCard({
  projectId,
  summary,
  loading,
}: {
  projectId: number
  summary?: ProjectDashboard['trizInnovationWorkbenchSummary']
  loading: boolean
}) {
  if (loading) {
    return <Skeleton className="h-28 w-full" aria-label="正在加载 TRIZ 创新工作台摘要" />
  }
  if (!summary) return null

  if (!summary.hasViewPermission || !summary.summary) {
    return (
      <Card variant="outlined">
        <CardContent className="pt-[var(--card-pad)]">
          <h2 className="text-lg font-semibold text-gray-800">创新工作台</h2>
          <p className="mt-2 text-sm text-gray-500">当前角色无权查看工作台摘要。</p>
        </CardContent>
      </Card>
    )
  }

  const data = summary.summary
  return (
    <Card variant="outlined">
      <CardContent className="space-y-4 pt-[var(--card-pad)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">创新工作台</h2>
            <p className="mt-1 text-sm text-gray-500">TRIZ 方案篮子的待审状态。</p>
          </div>
          <Link
            className="shrink-0 text-sm font-medium text-primary-600 hover:underline"
            href={`/projects/${projectId}/triz-workbench`}
          >
            打开工作台
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <SummaryMetric label="开放方案" value={data.openSchemeCount} />
          <SummaryMetric label="待审草案" value={data.pendingHandoffCount} />
          <SummaryMetric label="Warning" value={data.warningCount} />
          <SummaryMetric
            label="最高严重度"
            value={data.highestSeverity ? severityLabel(data.highestSeverity) : '—'}
          />
          <SummaryMetric label="Stale" value={data.staleMarker ? '有' : '无'} />
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border p-4">
      <span className="text-sm text-gray-500">{label}</span>
      <strong className="mt-1 block text-xl font-semibold text-gray-800">{value}</strong>
    </div>
  )
}

export function ContradictionSummaryCard({
  projectId,
  summary,
  loading,
}: {
  projectId: number
  summary?: ContradictionDashboardSummary
  loading: boolean
}) {
  if (loading) {
    return <Skeleton className="h-32 w-full" aria-label="正在加载项目矛盾摘要" />
  }
  if (!summary) return null

  const redacted = summary.warnings.includes('CONTRADICTION_PERMISSION_REDACTED')
  const unavailable = summary.warnings.includes('CONTRADICTION_DATA_UNAVAILABLE')

  return (
    <Card variant="outlined">
      <CardContent className="space-y-4 pt-[var(--card-pad)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-800">项目矛盾</h2>
            <p className="mt-1 text-sm text-gray-500">
              TRIZ 规则派生的低敏摘要，用于发现需要人工权衡的约束。
            </p>
          </div>
          {!redacted ? (
            <div className="flex shrink-0 gap-3">
              <Link
                className="text-sm font-medium text-primary-600 hover:underline"
                href={`/projects/${projectId}/triz/contradiction-matrix`}
              >
                查看矩阵
              </Link>
              <Link
                className="text-sm font-medium text-primary-600 hover:underline"
                href={`/projects/${projectId}/contradictions`}
              >
                查看全部
              </Link>
            </div>
          ) : null}
        </div>

        {redacted ? (
          <p className="text-sm text-gray-500">当前角色无权查看矛盾摘要。</p>
        ) : unavailable ? (
          <Alert variant="warning">矛盾摘要暂不可用，项目其他信息不受影响。</Alert>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[var(--radius-md)] border border-border p-4">
                <span className="text-sm text-gray-500">未解决矛盾</span>
                <strong className="mt-1 block text-2xl font-semibold text-gray-800">
                  {summary.unresolvedCount}
                </strong>
              </div>
              <div className="rounded-[var(--radius-md)] border border-border p-4">
                <span className="text-sm text-gray-500">已过期</span>
                <strong className="mt-1 block text-2xl font-semibold text-gray-800">
                  {summary.staleCount}
                </strong>
              </div>
            </div>
            <div className="min-w-0 rounded-[var(--radius-md)] border border-border p-4">
              <h3 className="text-sm font-medium text-gray-800">Top 矛盾</h3>
              {summary.topContradictions.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {summary.topContradictions.slice(0, 3).map((item) => (
                    <li key={item.id} className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityBadgeVariant(item.severity)}>
                          {severityLabel(item.severity)}
                        </Badge>
                        <span className="truncate text-sm font-medium text-gray-800">
                          {item.title}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{parameterPairLabel(item)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-gray-500">暂无未解决矛盾。</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function severityBadgeVariant(severity: ContradictionSeverity) {
  if (severity === 'critical') return 'danger'
  if (severity === 'high') return 'warning'
  if (severity === 'medium') return 'neutral'
  return 'outline'
}

function severityLabel(severity: ContradictionSeverity): string {
  const labels: Record<ContradictionSeverity, string> = {
    critical: '严重',
    high: '高',
    medium: '中',
    low: '低',
  }
  return labels[severity]
}

function parameterPairLabel(item: ContradictionDashboardSummary['topContradictions'][number]) {
  if (item.type === 'physical') {
    return item.parameterKey
      ? (getParameter(item.parameterKey)?.name ?? item.parameterKey)
      : '物理矛盾'
  }
  const improving = item.improvingParameterKey
    ? (getParameter(item.improvingParameterKey)?.name ?? item.improvingParameterKey)
    : '改善参数'
  const worsening = item.worseningParameterKey
    ? (getParameter(item.worseningParameterKey)?.name ?? item.worseningParameterKey)
    : '恶化参数'
  return `${improving} ↔ ${worsening}`
}

function sumMap(map: Record<string, number>): number {
  return Object.values(map).reduce((total, value) => total + value, 0)
}

function scalarMetricValue(metric: ReturnType<typeof getMetric>): number | string | null {
  const value = metric?.value
  return typeof value === 'number' || typeof value === 'string' ? value : null
}

function healthLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    green: '正常',
    healthy: '正常',
    yellow: '警告',
    warning: '警告',
    at_risk: '有风险',
    orange: '警告',
    red: '危险',
    critical: '危险',
    unknown: '未评估',
  }
  if (!status) return '未评估'
  return labels[status.toLowerCase()] ?? status
}
