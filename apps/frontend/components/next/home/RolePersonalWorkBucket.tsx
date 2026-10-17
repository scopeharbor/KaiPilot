'use client'

import * as React from 'react'
import {
  Clock,
  AlertTriangle,
  PlayCircle,
  Calendar,
  ExternalLink,
  Shield,
  Briefcase,
  UserCheck,
  TrendingUp,
  AlertCircle,
} from 'lucide-react'
import { useQuery, QueryClientContext } from '@tanstack/react-query'
import type { RoleBucket } from '@/lib/next/role-bucket'
import type { Task } from '@/lib/api/tasks'
import type { Project } from '@/lib/api/projects'
import { tasksApi } from '@/lib/api/tasks'
import { projectsApi } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'

export interface RolePersonalWorkBucketProps {
  bucket?: RoleBucket
  currentUserId?: number
  tasks?: Task[]
  projects?: Project[]
  onOpenHud?: () => void
  className?: string
}

export interface TaskMetrics {
  notStartedCount: number
  inProgressCount: number
  dueSoonCount: number
  overdueCount: number
  totalCount: number
  completedCount: number
  unassignedCount: number
}

/**
 * 计算任务四态量度（纯函数，可在测试中直接复用）
 * 1. 待开始：status === 'not_started'
 * 2. 进行中：status === 'in_progress'
 * 3. 即将截止：未完成且截止日在未来 3 天内
 * 4. 已逾期：未完成且截止日早于当前时间（已过截止期）
 */
export function calculateTaskMetrics(
  tasks: Task[],
  currentUserId?: number,
  isMemberOnly = false,
): TaskMetrics {
  const now = new Date()
  const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  let relevantTasks = tasks
  if (isMemberOnly && currentUserId !== undefined) {
    relevantTasks = tasks.filter((t) => t.assigneeId === currentUserId)
  }

  let notStartedCount = 0
  let inProgressCount = 0
  let dueSoonCount = 0
  let overdueCount = 0
  let completedCount = 0
  let unassignedCount = 0

  for (const t of relevantTasks) {
    if (t.assigneeId === null || t.assigneeId === undefined) {
      unassignedCount++
    }

    if (t.status === 'completed') {
      completedCount++
      continue
    }
    if (t.status === 'cancelled') {
      continue
    }

    if (t.status === 'not_started') {
      notStartedCount++
    } else if (t.status === 'in_progress') {
      inProgressCount++
    }

    if (t.endDate) {
      const end = new Date(t.endDate)
      if (end.getTime() < now.getTime()) {
        overdueCount++
      } else if (end.getTime() <= threeDaysLater.getTime()) {
        dueSoonCount++
      }
    }
  }

  return {
    notStartedCount,
    inProgressCount,
    dueSoonCount,
    overdueCount,
    totalCount: relevantTasks.length,
    completedCount,
    unassignedCount,
  }
}

/**
 * 角色首页个人工作桶跨项目任务增强微件（v3-ui-next-batch3-global-convergence W4 · tasks 4.1）。
 *
 * 聚合展示当前用户跨项目的待开始、进行中、即将截止与已逾期任务核心态势指标；
 * 针对 RBAC 四桶（admin/pm/member/observer）进行自适应呈现：
 * - admin 治理桶：重点呈现全组织跨项目未分配任务数与逾期风险总量；
 * - pm 交付桶：重点呈现当前负责的所有项目关键交付与任务推进；
 * - member 聚焦桶：以个人「我的待办清单」为核心，按截止时间严格升序排列；
 * - observer 洞察桶：呈现组织整体交付达成率与任务走势；
 * - 纯只读高密度暗黑仪器风，提供「打开 HUD」快捷通道。
 */
interface RolePersonalWorkBucketViewProps extends RolePersonalWorkBucketProps {
  tasks: Task[]
  projects: Project[]
  isLoading?: boolean
}

function RolePersonalWorkBucketView({
  bucket: propBucket,
  currentUserId: propUserId,
  tasks: allTasks,
  projects,
  onOpenHud,
  className = '',
  isLoading = false,
}: RolePersonalWorkBucketViewProps) {
  const storeUser = useAuthStore((s) => s.user)
  const storeBucket = useAuthStore((s) => {
    // 简易派生或使用 store 用户角色
    if (s.user?.isSuperAdmin) return 'admin'
    return 'member'
  })

  const effectiveBucket: RoleBucket = propBucket ?? storeBucket
  const effectiveUserId = propUserId ?? storeUser?.id

  // 针对 member 视角提取当前用户个人任务；admin/pm/observer 视角结合全局数据
  const isMemberRole = effectiveBucket === 'member'
  const metrics = calculateTaskMetrics(allTasks, effectiveUserId, isMemberRole)

  // 针对 member 视角按截止时间升序排序的待办列表
  const memberTodoList = React.useMemo(() => {
    const list = effectiveUserId
      ? allTasks.filter(
          (t) =>
            t.assigneeId === effectiveUserId &&
            t.status !== 'completed' &&
            t.status !== 'cancelled',
        )
      : allTasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
    return list.sort((a, b) => {
      if (!a.endDate) return 1
      if (!b.endDate) return -1
      return new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
    })
  }, [allTasks, effectiveUserId])

  // 交付达成率
  const completionRate =
    metrics.totalCount > 0 ? Math.round((metrics.completedCount / metrics.totalCount) * 100) : 0

  return (
    <section
      data-role-personal-work-bucket
      data-role-bucket={effectiveBucket}
      aria-label="跨项目任务工作桶"
      className={`relative z-[1] flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 ${className}`}
    >
      {/* 标题栏与 HUD 激活入口 */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] pb-3">
        <div className="flex items-center gap-2">
          {effectiveBucket === 'admin' && <Shield className="h-4 w-4 text-[var(--nx-accent)]" />}
          {effectiveBucket === 'pm' && (
            <Briefcase className="h-4 w-4 text-[var(--nx-status-info)]" />
          )}
          {effectiveBucket === 'member' && (
            <UserCheck className="h-4 w-4 text-[var(--nx-accent)]" />
          )}
          {effectiveBucket === 'observer' && (
            <TrendingUp className="h-4 w-4 text-[var(--nx-text-muted)]" />
          )}
          <h2 className="text-sm font-semibold tracking-[0.02em] text-[var(--nx-text-primary)]">
            {effectiveBucket === 'admin' && '组织任务治理工作桶'}
            {effectiveBucket === 'pm' && '项目交付工作桶'}
            {effectiveBucket === 'member' && '我的工作聚焦（个人工作桶）'}
            {effectiveBucket === 'observer' && '全域交付洞察工作桶'}
            {effectiveBucket === 'unknown' && '跨项目工作聚焦'}
          </h2>
          <span className="font-mono text-xs text-[var(--nx-text-muted)]">
            {effectiveBucket.toUpperCase()} · HUD-SYNC
          </span>
        </div>

        {onOpenHud && (
          <button
            type="button"
            onClick={onOpenHud}
            aria-label="打开跨项目任务 HUD"
            className="flex items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-bg-2)]"
          >
            <span>打开 HUD</span>
            <ExternalLink className="h-3 w-3 text-[var(--nx-text-muted)]" />
          </button>
        )}
      </div>

      {isLoading && allTasks.length === 0 ? (
        <div className="py-6 text-center text-xs text-[var(--nx-text-muted)]">
          正在聚合跨项目任务态势…
        </div>
      ) : (
        <>
          {/* 四大态势量度指标丝带 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {/* 待开始 */}
            <div className="flex flex-col rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5">
              <div className="flex items-center justify-between text-[var(--nx-text-muted)]">
                <span className="text-[11px] font-medium">待开始</span>
                <Clock className="h-3.5 w-3.5" />
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-[var(--nx-text-primary)]">
                {metrics.notStartedCount}
              </div>
            </div>

            {/* 进行中 */}
            <div className="flex flex-col rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5">
              <div className="flex items-center justify-between text-[var(--nx-text-muted)]">
                <span className="text-[11px] font-medium">进行中</span>
                <PlayCircle className="h-3.5 w-3.5 text-[var(--nx-status-info)]" />
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-[var(--nx-status-info)]">
                {metrics.inProgressCount}
              </div>
            </div>

            {/* 即将截止 (3天内) */}
            <div className="flex flex-col rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5">
              <div className="flex items-center justify-between text-[var(--nx-text-muted)]">
                <span className="text-[11px] font-medium">即将截止</span>
                <Calendar className="h-3.5 w-3.5 text-[var(--nx-status-warning)]" />
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-[var(--nx-status-warning)]">
                {metrics.dueSoonCount}
              </div>
            </div>

            {/* 已逾期 */}
            <div className="flex flex-col rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5">
              <div className="flex items-center justify-between text-[var(--nx-text-muted)]">
                <span className="text-[11px] font-medium">已逾期</span>
                <AlertTriangle className="h-3.5 w-3.5 text-[var(--nx-status-danger)]" />
              </div>
              <div className="mt-1 flex items-baseline gap-1.5 font-mono text-lg font-semibold text-[var(--nx-status-danger)]">
                <span>{metrics.overdueCount}</span>
                {metrics.overdueCount > 0 && (
                  <span className="rounded bg-[var(--nx-status-danger)]/15 px-1 py-0.2 text-[10px] font-normal">
                    风险
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* RBAC 四桶自适应差异化详情区 */}
          {effectiveBucket === 'admin' && (
            <div
              data-bucket-view="admin"
              className="mt-1 flex flex-col gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/60 p-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-[var(--nx-text-muted)]">跨项目治理未分配任务</span>
                <span className="font-mono font-medium text-[var(--nx-status-warning)]">
                  {metrics.unassignedCount} 项未分配
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--nx-text-muted)]">全组织逾期风险总量</span>
                <span className="font-mono font-medium text-[var(--nx-status-danger)]">
                  {metrics.overdueCount} 项高风险逾期
                </span>
              </div>
            </div>
          )}

          {effectiveBucket === 'pm' && (
            <div
              data-bucket-view="pm"
              className="mt-1 flex flex-col gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/60 p-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-[var(--nx-text-muted)]">负责项目交付推进</span>
                <span className="font-mono font-medium text-[var(--nx-status-info)]">
                  {projects.length} 个活跃项目 · {metrics.inProgressCount} 项推进中
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--nx-text-muted)]">里程碑交付预警</span>
                <span className="font-mono font-medium text-[var(--nx-text-primary)]">
                  {metrics.dueSoonCount > 0 ? `${metrics.dueSoonCount} 项排程临界` : '排程正常'}
                </span>
              </div>
            </div>
          )}

          {effectiveBucket === 'member' && (
            <div
              data-bucket-view="member"
              className="mt-1 flex flex-col gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/60 p-3 text-xs"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-[var(--nx-text-primary)]">我的待办清单</span>
                <span className="font-mono text-[11px] text-[var(--nx-text-muted)]">
                  按截止期严格升序
                </span>
              </div>
              {memberTodoList.length === 0 ? (
                <p className="py-2 text-center text-[var(--nx-text-muted)]">暂无待办任务</p>
              ) : (
                <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
                  {memberTodoList.slice(0, 5).map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-[var(--nx-bg-1)]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            task.priority === 'highest' || task.priority === 'high'
                              ? 'bg-[var(--nx-status-danger)]'
                              : 'bg-[var(--nx-accent)]'
                          }`}
                        />
                        <span className="truncate text-[var(--nx-text-primary)]">{task.name}</span>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--nx-text-muted)]">
                        {task.endDate ? task.endDate.slice(0, 10) : '无截止期'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {effectiveBucket === 'observer' && (
            <div
              data-bucket-view="observer"
              className="mt-1 flex flex-col gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/60 p-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-[var(--nx-text-muted)]">组织整体交付达成率</span>
                <span className="font-mono font-medium text-[var(--nx-text-primary)]">
                  {completionRate}% ({metrics.completedCount}/{metrics.totalCount})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--nx-text-muted)]">关注任务只读走势</span>
                <span className="font-mono text-[var(--nx-status-info)]">
                  {metrics.inProgressCount} 进行中 / {metrics.overdueCount} 逾期
                </span>
              </div>
            </div>
          )}

          {effectiveBucket === 'unknown' && (
            <div
              data-bucket-view="unknown"
              className="mt-1 flex items-center justify-between rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/60 p-3 text-xs"
            >
              <span className="text-[var(--nx-text-muted)]">登录以查看个人指派任务工作桶</span>
              <AlertCircle className="h-4 w-4 text-[var(--nx-text-muted)]" />
            </div>
          )}
        </>
      )}
    </section>
  )
}

function RolePersonalWorkBucketLive(props: RolePersonalWorkBucketProps) {
  const currentOrganizationId = useAuthStore((s) => s.currentOrganizationId)
  const { data: remoteData, isLoading } = useQuery({
    queryKey: ['cross-project-tasks', currentOrganizationId],
    queryFn: async () => {
      const projRes = await projectsApi.list({ perPage: 20 })
      const projects = projRes.data ?? []
      const taskArrays = await Promise.all(
        projects.map(async (p) => {
          try {
            const tRes = await tasksApi.list(p.id, { perPage: 100 })
            return (tRes.data ?? []).map((task) => ({
              ...task,
              projectName: p.name,
              projectCode: p.code,
            }))
          } catch {
            return []
          }
        }),
      )
      return {
        projects,
        tasks: taskArrays.flat(),
      }
    },
    enabled: props.tasks === undefined && currentOrganizationId !== null,
    staleTime: 60_000,
  })

  return (
    <RolePersonalWorkBucketView
      {...props}
      tasks={props.tasks ?? remoteData?.tasks ?? []}
      projects={props.projects ?? remoteData?.projects ?? []}
      isLoading={isLoading}
    />
  )
}

export function RolePersonalWorkBucket(props: RolePersonalWorkBucketProps) {
  const hasQueryClient = React.useContext(QueryClientContext) !== undefined
  if (props.tasks) {
    return (
      <RolePersonalWorkBucketView {...props} tasks={props.tasks} projects={props.projects ?? []} />
    )
  }
  if (!hasQueryClient) {
    return null
  }
  return <RolePersonalWorkBucketLive {...props} />
}
