'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { TaskDependenciesPanel } from '@/components/tasks/TaskDependenciesPanel'
import { TaskExternalLinksPanel } from '@/components/views/tasks/TaskExternalLinksPanel'
import { Badge } from '@/components/ui/Badge'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { Skeleton } from '@/components/ui/Skeleton'
import { taskKeys, tasksApi } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'

export default function TaskDetailPage() {
  const params = useParams<{ id: string; taskId: string }>()
  const projectId = Number(params.id)
  const taskId = Number(params.taskId)
  const task = useQuery({
    queryKey: taskKeys.detail(projectId, taskId),
    queryFn: () => tasksApi.get(projectId, taskId),
  })
  const userId = useAuthStore((state) => state.user?.id)
  const hasPermission = useAuthStore((state) => state.hasPermission)

  if (task.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <BrandLoader size={56} label="正在载入任务详情…" />
        <Skeleton className="h-80 w-full" aria-label="正在加载任务详情" />
      </div>
    )
  }
  if (task.isError || !task.data) {
    return (
      <div className="rounded-[var(--radius-md)] border border-danger bg-danger-bg p-5 text-sm text-danger">
        任务详情加载失败，请返回任务列表后重试。
      </div>
    )
  }

  const canEdit =
    hasPermission('task:update') ||
    (hasPermission('task:update:self') && task.data.assigneeId === userId)

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-[var(--radius-md)] border border-border bg-gray-0 p-5">
        <Link
          href={`/projects/${projectId}/list`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          返回任务列表
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{task.data.name}</h1>
            <p className="mt-1 text-sm text-gray-500">
              在这里维护任务间的排程约束；甘特图连线将在专业排程阶段提供。
            </p>
          </div>
          <Badge variant="primary">共 {task.data.dependencyCount ?? 0} 条依赖</Badge>
        </div>
      </div>
      <div className="rounded-[var(--radius-md)] border border-border bg-gray-0 p-5">
        <TaskDependenciesPanel projectId={projectId} taskId={taskId} canEdit={canEdit} />
      </div>
      <div className="rounded-[var(--radius-md)] border border-border bg-gray-0 p-5">
        <TaskExternalLinksPanel projectId={projectId} taskId={taskId} />
      </div>
    </div>
  )
}
