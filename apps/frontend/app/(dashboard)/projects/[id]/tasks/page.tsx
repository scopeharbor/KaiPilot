'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, Search } from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { TaskBatchActionBar } from '@/components/views/tasks/TaskBatchActionBar'
import { TaskBatchResultAlert } from '@/components/views/tasks/TaskBatchResultAlert'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import { useTaskSelection } from '@/hooks/use-task-selection'
import { projectKeys, projectMembersApi } from '@/lib/api/projects'
import {
  taskKeys,
  tasksApi,
  type TaskBatchInput,
  type TaskBatchResult,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  on_hold: '已暂停',
  cancelled: '已取消',
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

export default function ProjectTaskBatchPage() {
  const projectId = Number(useParams().id)
  return (
    <PermissionGuard
      require="task:view"
      fallback={<Alert className="my-8">无权查看项目任务</Alert>}
    >
      <TaskBatchPageContent projectId={projectId} />
    </PermissionGuard>
  )
}

function TaskBatchPageContent({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const selection = useTaskSelection()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<TaskBatchResult | null>(null)
  const filters = useMemo(
    () => ({ search: search || undefined, page, perPage: 20 }),
    [page, search],
  )
  const tasks = useQuery({
    queryKey: taskKeys.list(projectId, filters),
    queryFn: () => tasksApi.list(projectId, filters),
  })
  const members = useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectMembersApi.list(projectId),
  })
  const batch = useMutation({
    mutationFn: (input: TaskBatchInput) => tasksApi.batch(projectId, input),
    onSuccess: async (nextResult) => {
      setResult(nextResult)
      selection.retain(
        nextResult.results.filter((item) => !item.success).map((item) => item.taskId),
      )
      await invalidateTaskQueries(queryClient, projectId)
    },
  })

  const rows = tasks.data?.data ?? []
  const pageIds = rows.map((task) => task.id)
  const selectedOnPage = pageIds.filter((taskId) => selection.selectedIds.has(taskId)).length
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length
  const somePageSelected = selectedOnPage > 0 && !allPageSelected

  return (
    <div className="space-y-5 pb-12 pt-2">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary-600">
            日常任务操作
          </p>
          <h2 className="text-2xl font-semibold text-gray-800 text-balance">批量管理任务</h2>
          <p className="max-w-2xl text-sm text-gray-500">
            当前页面提供批量编辑、指派、状态变更和移入回收站；完整列表视图将在后续增强。
          </p>
        </div>
        <PermissionGuard require="task:delete">
          <Button asChild variant="secondary">
            <Link href={`/projects/${projectId}/tasks/recycle-bin`}>
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              打开回收站
            </Link>
          </Button>
        </PermissionGuard>
      </header>

      <TaskBatchResultAlert result={result} />
      {batch.isError ? (
        <Alert variant="danger" title="批量请求失败">
          {(batch.error as { message?: string }).message ?? '请稍后重试'}
        </Alert>
      ) : null}

      <Card variant="outlined">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border p-[var(--card-pad)] sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:max-w-sm">
              <span className="sr-only">搜索任务</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <Input
                className="pl-9"
                value={search}
                placeholder="搜索任务名称或描述"
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </label>
            <span className="text-sm text-gray-500">
              共 {tasks.data?.meta.total ?? 0} 项 · 最多批量选择 100 项
            </span>
          </div>

          {tasks.isLoading ? <TaskTableSkeleton /> : null}
          {tasks.isError ? (
            <Alert className="m-[var(--card-pad)]" variant="danger" title="任务加载失败" />
          ) : null}
          {tasks.data && rows.length === 0 ? (
            <EmptyState
              title={search ? '没有匹配的任务' : '项目还没有任务'}
              description={
                search ? '尝试缩短关键词或清空搜索条件。' : '创建任务后即可在这里批量管理。'
              }
            />
          ) : null}
          {rows.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableCaption>项目任务批量管理列表</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        aria-label="选择当前页全部任务"
                        checked={
                          allPageSelected ? true : somePageSelected ? 'indeterminate' : false
                        }
                        onCheckedChange={(checked) =>
                          selection.setPageSelected(pageIds, checked === true)
                        }
                      />
                    </TableHead>
                    <TableHead>任务</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>优先级</TableHead>
                    <TableHead>负责人</TableHead>
                    <TableHead>计划结束</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={`选择任务 ${task.name}`}
                          checked={selection.selectedIds.has(task.id)}
                          onCheckedChange={(checked) => selection.toggle(task.id, checked === true)}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          className="font-medium text-gray-800 hover:text-primary-600 hover:underline"
                          href={`/projects/${projectId}/tasks/${task.id}`}
                        >
                          {task.name}
                        </Link>
                        <span className="mt-0.5 block text-xs text-gray-500">#{task.id}</span>
                      </TableCell>
                      <TableCell>{STATUS_LABELS[task.status]}</TableCell>
                      <TableCell>{PRIORITY_LABELS[task.priority]}</TableCell>
                      <TableCell>
                        {task.assignee?.fullName || task.assignee?.email || '未指派'}
                      </TableCell>
                      <TableCell>{formatDate(task.endDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {tasks.data && tasks.data.meta.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-border px-[var(--card-pad)] py-3">
              <span className="text-sm text-gray-500">
                第 {tasks.data.meta.page} / {tasks.data.meta.totalPages} 页
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= tasks.data.meta.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <TaskBatchActionBar
        selectedIds={[...selection.selectedIds].slice(0, 100)}
        members={members.data ?? []}
        pending={batch.isPending}
        onClear={selection.clear}
        onExecute={(input) => batch.mutate(input)}
      />
    </div>
  )
}

function TaskTableSkeleton() {
  return (
    <div className="space-y-3 p-[var(--card-pad)]" aria-label="正在加载任务">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  )
}

function formatDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN') : '未设置'
}
