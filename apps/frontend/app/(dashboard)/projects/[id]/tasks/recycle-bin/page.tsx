'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, ArrowLeft, Search } from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { TaskBatchResultAlert } from '@/components/views/tasks/TaskBatchResultAlert'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
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
import { taskKeys, tasksApi, type TaskBatchResult, type TaskStatus } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  on_hold: '已暂停',
  cancelled: '已取消',
}

export default function ProjectTaskRecycleBinPage() {
  const projectId = Number(useParams().id)
  return (
    <PermissionGuard
      require="task:delete"
      fallback={<Alert className="my-8">无权查看或恢复已删除任务</Alert>}
    >
      <RecycleBinContent projectId={projectId} />
    </PermissionGuard>
  )
}

function RecycleBinContent({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const selection = useTaskSelection()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState<TaskBatchResult | null>(null)
  const filters = useMemo(
    () => ({ search: search || undefined, page, perPage: 20, sort: '-deletedAt' as const }),
    [page, search],
  )
  const tasks = useQuery({
    queryKey: taskKeys.recycleBin(projectId, filters),
    queryFn: () => tasksApi.listRecycleBin(projectId, filters),
  })
  const restore = useMutation({
    mutationFn: (taskIds: number[]) => tasksApi.batchRestore(projectId, taskIds),
    onSuccess: async (nextResult) => {
      setResult(nextResult)
      selection.retain(
        nextResult.results.filter((item) => !item.success).map((item) => item.taskId),
      )
      setConfirmOpen(false)
      await invalidateTaskQueries(queryClient, projectId)
    },
  })

  const rows = tasks.data?.data ?? []
  const pageIds = rows.map((task) => task.id)
  const selectedOnPage = pageIds.filter((taskId) => selection.selectedIds.has(taskId)).length
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length
  const somePageSelected = selectedOnPage > 0 && !allPageSelected
  const selectedIds = [...selection.selectedIds].slice(0, 100)

  return (
    <div className="space-y-5 pb-12 pt-2">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <Link
            href={`/projects/${projectId}/tasks`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            返回任务批量管理
          </Link>
          <h2 className="text-2xl font-semibold text-gray-800">任务回收站</h2>
          <p className="text-sm text-gray-500">只显示删除未满 30 天的任务；V1 不提供永久删除。</p>
        </div>
        {selectedIds.length ? (
          <Button onClick={() => setConfirmOpen(true)}>
            <ArchiveRestore className="h-4 w-4" aria-hidden />
            恢复所选 {selectedIds.length} 项
          </Button>
        ) : null}
      </header>

      <TaskBatchResultAlert result={result} />
      {restore.isError ? (
        <Alert variant="danger" title="恢复请求失败">
          {(restore.error as { message?: string }).message ?? '请稍后重试'}
        </Alert>
      ) : null}

      <Card variant="outlined">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border p-[var(--card-pad)] sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:max-w-sm">
              <span className="sr-only">搜索已删除任务</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <Input
                className="pl-9"
                value={search}
                placeholder="搜索已删除任务"
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </label>
            <span className="text-sm text-gray-500">共 {tasks.data?.meta.total ?? 0} 项</span>
          </div>

          {tasks.isLoading ? (
            <div className="space-y-3 p-[var(--card-pad)]" aria-label="正在加载回收站">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : null}
          {tasks.isError ? (
            <Alert className="m-[var(--card-pad)]" variant="danger" title="回收站加载失败" />
          ) : null}
          {tasks.data && rows.length === 0 ? (
            <EmptyState
              icon={ArchiveRestore}
              title={search ? '没有匹配的已删除任务' : '回收站是空的'}
              description="任务移入回收站后，会在可恢复期限内显示在这里。"
            />
          ) : null}
          {rows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableCaption>任务回收站列表</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        aria-label="选择当前页全部已删除任务"
                        checked={
                          allPageSelected ? true : somePageSelected ? 'indeterminate' : false
                        }
                        onCheckedChange={(checked) =>
                          selection.setPageSelected(pageIds, checked === true)
                        }
                      />
                    </TableHead>
                    <TableHead>任务</TableHead>
                    <TableHead>删除前状态</TableHead>
                    <TableHead>删除时间</TableHead>
                    <TableHead>剩余可恢复时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={`选择已删除任务 ${task.name}`}
                          checked={selection.selectedIds.has(task.id)}
                          onCheckedChange={(checked) => selection.toggle(task.id, checked === true)}
                        />
                      </TableCell>
                      <TableCell>
                        <strong className="font-medium text-gray-800">{task.name}</strong>
                        <span className="mt-0.5 block text-xs text-gray-500">#{task.id}</span>
                      </TableCell>
                      <TableCell>{STATUS_LABELS[task.status]}</TableCell>
                      <TableCell>{new Date(task.deletedAt).toLocaleString('zh-CN')}</TableCell>
                      <TableCell>{remainingDays(task.deletedAt)} 天</TableCell>
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

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>恢复 {selectedIds.length} 项任务？</DialogTitle>
            <DialogDescription>
              成功项会重新出现在普通任务视图；超过恢复期限的任务会保留并报告失败。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button loading={restore.isPending} onClick={() => restore.mutate(selectedIds)}>
              确认恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function remainingDays(deletedAt: string) {
  const elapsed = (Date.now() - new Date(deletedAt).getTime()) / 86_400_000
  return Math.max(0, Math.ceil(30 - elapsed))
}
