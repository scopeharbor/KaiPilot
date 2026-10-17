'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine, Link2, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useCreateDependency,
  useDeleteDependency,
  useTaskDependencies,
} from '@/hooks/use-task-dependencies'
import type { DependencyType, TaskDependency } from '@/lib/api/dependencies'
import { taskKeys, tasksApi } from '@/lib/api/tasks'

const dependencyLabels: Record<DependencyType, { short: string; name: string }> = {
  fs: { short: 'FS', name: '完成 → 开始' },
  ss: { short: 'SS', name: '开始 → 开始' },
  ff: { short: 'FF', name: '完成 → 完成' },
  sf: { short: 'SF', name: '开始 → 完成' },
}

function DependencyRow({
  dependency,
  direction,
  canEdit,
  confirming,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  deleting,
}: {
  dependency: TaskDependency
  direction: 'predecessor' | 'successor'
  canEdit: boolean
  confirming: boolean
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  deleting: boolean
}) {
  const task = direction === 'predecessor' ? dependency.predecessor : dependency.successor
  const lag =
    dependency.lagDays === 0
      ? '无延迟'
      : `${dependency.lagDays > 0 ? '+' : ''}${dependency.lagDays} 天`
  return (
    <li className="flex min-h-14 min-w-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
        {direction === 'predecessor' ? (
          <ArrowDownToLine className="h-4 w-4" aria-hidden />
        ) : (
          <ArrowUpFromLine className="h-4 w-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1 basis-24">
        <p className="truncate text-sm font-medium text-gray-800">{task.name}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {dependencyLabels[dependency.type].name} · {lag}
        </p>
      </div>
      <Badge variant="outline">{dependencyLabels[dependency.type].short}</Badge>
      {canEdit ? (
        confirming ? (
          <span className="flex w-full flex-wrap items-center justify-end gap-1.5">
            <span className="text-xs text-muted">删除后日期不变</span>
            <Button
              type="button"
              size="sm"
              variant="danger"
              aria-label={`确认删除与${task.name}的依赖`}
              loading={deleting}
              onClick={onConfirmDelete}
            >
              确认解除
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="取消删除依赖"
              disabled={deleting}
              onClick={onCancelDelete}
            >
              取消
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`删除与${task.name}的依赖`}
            onClick={onRequestDelete}
          >
            <Trash2 className="h-4 w-4 text-danger" aria-hidden />
          </Button>
        )
      ) : null}
    </li>
  )
}

export function TaskDependenciesPanel({
  projectId,
  taskId,
  canEdit,
}: {
  projectId: number
  taskId: number
  canEdit: boolean
}) {
  const dependencies = useTaskDependencies(projectId, taskId)
  const createDependency = useCreateDependency(projectId, taskId)
  const deleteDependency = useDeleteDependency(projectId, taskId)
  const tasks = useQuery({
    queryKey: taskKeys.list(projectId, { perPage: 100, sort: '+name' }),
    queryFn: () => tasksApi.list(projectId, { perPage: 100, sort: '+name' }),
  })
  const [predecessorId, setPredecessorId] = useState('')
  const [type, setType] = useState<DependencyType>('fs')
  const [lagDays, setLagDays] = useState('0')
  // 删除依赖需先确认（task 3.5/3.7）：记录待确认的依赖 id。
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  const candidates = useMemo(() => {
    const occupied = new Set(
      dependencies.data?.predecessors.map((item) => item.predecessorId) ?? [],
    )
    return (tasks.data?.data ?? []).filter((task) => task.id !== taskId && !occupied.has(task.id))
  }, [dependencies.data?.predecessors, taskId, tasks.data?.data])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!predecessorId) return
    createDependency.mutate(
      { predecessorId: Number(predecessorId), type, lagDays: Number(lagDays) },
      { onSuccess: () => setPredecessorId('') },
    )
  }

  if (dependencies.isLoading) {
    return (
      <section aria-label="正在加载依赖关系" className="space-y-3">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </section>
    )
  }

  if (dependencies.isError) {
    return (
      <div className="rounded-[var(--radius-md)] border border-danger bg-danger-bg p-4">
        <p className="text-sm font-medium text-danger">依赖关系加载失败</p>
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          onClick={() => dependencies.refetch()}
        >
          重试
        </Button>
      </div>
    )
  }

  const groups = dependencies.data ?? { predecessors: [], successors: [] }
  return (
    <section className="@container min-w-0 space-y-5" aria-labelledby="task-dependencies-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary-500" aria-hidden />
            <h2 id="task-dependencies-title" className="text-lg font-semibold text-gray-800">
              依赖关系
            </h2>
            <Badge variant="neutral">{groups.predecessors.length + groups.successors.length}</Badge>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            项目经理调整前置任务的日期时，后续任务会按依赖自动顺延，并通知相关负责人。
          </p>
        </div>
        {!canEdit ? <Badge variant="outline">只读</Badge> : null}
      </div>

      {canEdit ? (
        <form
          onSubmit={submit}
          className="grid min-w-0 grid-cols-1 gap-3 rounded-[var(--radius-md)] border border-border bg-gray-50 p-4 @min-[28rem]:grid-cols-2 @min-[48rem]:grid-cols-[minmax(0,1fr)_160px_120px_auto]"
        >
          <label className="min-w-0 space-y-1 text-xs font-medium text-gray-600">
            前置任务
            <Combobox
              aria-label="选择前置任务"
              value={predecessorId}
              onValueChange={setPredecessorId}
              options={candidates.map((task) => ({ value: String(task.id), label: task.name }))}
              placeholder="选择本项目任务"
              searchPlaceholder="搜索任务名称…"
              emptyText="没有可添加的任务"
            />
          </label>
          <label className="min-w-0 space-y-1 text-xs font-medium text-gray-600">
            依赖类型
            <Select value={type} onValueChange={(value) => setType(value as DependencyType)}>
              <SelectTrigger aria-label="选择依赖类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(dependencyLabels) as DependencyType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {dependencyLabels[key].short} · {dependencyLabels[key].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="min-w-0 space-y-1 text-xs font-medium text-gray-600">
            提前 / 延迟（天）
            <Input
              type="number"
              step={1}
              value={lagDays}
              aria-label="提前或延迟天数"
              onChange={(event) => setLagDays(event.target.value)}
            />
          </label>
          <Button
            className="self-end"
            type="submit"
            disabled={!predecessorId}
            loading={createDependency.isPending}
          >
            <Plus className="h-4 w-4" aria-hidden />
            添加
          </Button>
        </form>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 @min-[40rem]:grid-cols-2">
        {[
          {
            title: '前置任务',
            description: '这些任务约束当前任务',
            direction: 'predecessor' as const,
            items: groups.predecessors,
          },
          {
            title: '后续任务',
            description: '当前任务约束这些任务',
            direction: 'successor' as const,
            items: groups.successors,
          },
        ].map((group) => (
          <div
            key={group.direction}
            className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border"
          >
            <div className="border-b border-border bg-gray-50 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">{group.title}</h3>
              <p className="mt-0.5 text-xs text-gray-500">{group.description}</p>
            </div>
            {group.items.length ? (
              <ul>
                {group.items.map((dependency) => (
                  <DependencyRow
                    key={dependency.id}
                    dependency={dependency}
                    direction={group.direction}
                    canEdit={canEdit}
                    confirming={pendingDeleteId === dependency.id}
                    deleting={
                      deleteDependency.isPending && deleteDependency.variables === dependency.id
                    }
                    onRequestDelete={() => setPendingDeleteId(dependency.id)}
                    onCancelDelete={() => setPendingDeleteId(null)}
                    onConfirmDelete={() =>
                      deleteDependency.mutate(dependency.id, {
                        onSuccess: () => setPendingDeleteId(null),
                      })
                    }
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                className="py-8"
                icon={Link2}
                title={`暂无${group.title}`}
                description={
                  group.direction === 'predecessor'
                    ? '添加前置任务后，系统会阻止循环依赖。'
                    : '当其他任务依赖当前任务时，会显示在这里。'
                }
              />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
