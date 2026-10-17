'use client'

import { useQueries, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CheckSquare, FolderOpen } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import { PageReadinessBanner } from '@/components/help/PageReadinessBanner'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import { taskKeys, tasksApi, type TaskListFilters, type TaskStatus } from '@/lib/api/tasks'
import {
  OPEN_TASK_STATUSES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  sortTasksByDue,
  toIsoDate,
} from '@/lib/cross-project-tasks'
import { readinessFor } from '@/lib/help/readiness'
import { useAuthStore } from '@/stores/auth-store'

/** 单项目单次最多拉取的任务数（后端 perPage 上限 100）。 */
const PER_PROJECT_LIMIT = 100
/** 聚合覆盖的项目数上限（与项目列表一页对齐）。 */
const PROJECT_LIMIT = 50

type Scope = 'mine' | 'all'
type StatusFilter = 'open' | 'all' | TaskStatus

/**
 * `/tasks` 跨项目任务聚合视图。
 *
 * 复用项目级任务接口按项目并行拉取后在前端聚合（无新增后端端点）：
 * - 默认「我的任务 + 未完成」，可切换全部成员与状态；
 * - 单项目失败不拖垮整页，失败项目单独提示；超出单项目上限时如实标注截断。
 */
export default function TasksPage() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const [scope, setScope] = useState<Scope>('mine')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [search, setSearch] = useState('')

  const projectsQuery = useQuery({
    queryKey: projectKeys.list(organizationId ?? 0, { perPage: PROJECT_LIMIT }),
    queryFn: () => projectsApi.list({ perPage: PROJECT_LIMIT }),
    enabled: organizationId !== null,
  })
  const projects = useMemo(() => projectsQuery.data?.data ?? [], [projectsQuery.data])

  const filters: TaskListFilters = useMemo(
    () => ({
      perPage: PER_PROJECT_LIMIT,
      ...(scope === 'mine' && userId ? { assigneeId: userId } : {}),
      ...(statusFilter !== 'open' && statusFilter !== 'all' ? { status: statusFilter } : {}),
    }),
    [scope, userId, statusFilter],
  )

  const taskQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: taskKeys.list(project.id, filters),
      queryFn: () => tasksApi.list(project.id, filters),
    })),
  })

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )

  const loadingTasks = taskQueries.some((q) => q.isLoading)
  const failedProjects = projects.filter((_, index) => taskQueries[index]?.isError)
  const truncatedProjects = projects.filter((_, index) => {
    const meta = taskQueries[index]?.data?.meta
    return meta ? meta.total > PER_PROJECT_LIMIT : false
  })

  const keyword = search.trim().toLowerCase()
  const rows = sortTasksByDue(
    taskQueries
      .flatMap((q) => q.data?.data ?? [])
      .filter((task) => (statusFilter === 'open' ? OPEN_TASK_STATUSES.includes(task.status) : true))
      .filter((task) => (keyword ? task.name.toLowerCase().includes(keyword) : true)),
  )

  const today = toIsoDate(new Date())

  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }

  return (
    <div className="space-y-6 py-6" data-testid="cross-project-tasks-page">
      <h1 className="text-2xl font-semibold tracking-tight">任务</h1>
      <PageReadinessBanner readiness={readinessFor('/tasks')!} helpArticleTitle="项目视图总览" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="任务范围">
          {(['mine', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={`rounded px-3 py-1 text-sm ${scope === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              {value === 'mine' ? '我的任务' : '全部任务'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">状态</span>
          <select
            aria-label="状态筛选"
            className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="open">未完成</option>
            <option value="all">全部状态</option>
            {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <Input
          aria-label="搜索任务"
          placeholder="搜索任务名称"
          className="w-56"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-muted-foreground" data-testid="task-count">
          共 {rows.length} 项 · 覆盖 {projects.length} 个项目
        </span>
      </div>

      {failedProjects.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            以下项目的任务加载失败（可能无权限或服务异常）：
            {failedProjects.map((p) => p.name).join('、')}
          </AlertDescription>
        </Alert>
      )}
      {truncatedProjects.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            以下项目任务超过 {PER_PROJECT_LIMIT} 项，仅显示前 {PER_PROJECT_LIMIT}{' '}
            项，请进入项目查看完整列表：
            {truncatedProjects.map((p) => p.name).join('、')}
          </AlertDescription>
        </Alert>
      )}

      {projectsQuery.isLoading || loadingTasks ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((k) => (
            <Skeleton key={k} className="h-12 w-full" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="还没有项目"
          description="创建项目并添加任务后，这里会汇总你在各项目中的任务。"
          action={
            <Link href="/projects/new" className="text-sm text-primary hover:underline">
              创建项目
            </Link>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={scope === 'mine' ? '暂无分配给你的任务' : '暂无符合条件的任务'}
          description="可以切换「全部任务」或调整状态筛选。"
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>项目</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>优先级</TableHead>
                  <TableHead>负责人</TableHead>
                  <TableHead>截止日</TableHead>
                  <TableHead>进度</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((task) => {
                  const due = task.endDate?.slice(0, 10) ?? null
                  const overdue =
                    due !== null && due < today && !['completed', 'cancelled'].includes(task.status)
                  return (
                    <TableRow
                      key={`${task.projectId}-${task.id}`}
                      data-testid="cross-project-task-row"
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/projects/${task.projectId}/tasks`}
                          className="text-primary hover:underline"
                        >
                          {task.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {projectNameById.get(task.projectId) ?? `#${task.projectId}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={task.status === 'blocked' ? 'danger' : 'neutral'}>
                          {TASK_STATUS_LABELS[task.status] ?? task.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{TASK_PRIORITY_LABELS[task.priority] ?? task.priority}</TableCell>
                      <TableCell>
                        {task.assignee?.fullName ?? task.assignee?.email ?? '—'}
                      </TableCell>
                      <TableCell className={overdue ? 'font-medium text-red-600' : undefined}>
                        {due ?? '—'}
                        {overdue && <span className="ml-1 text-xs">已逾期</span>}
                      </TableCell>
                      <TableCell>{task.progressPercent}%</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
