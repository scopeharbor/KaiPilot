'use client'

import { useParams } from 'next/navigation'
import PermissionGuard from '@/components/PermissionGuard'
import { TaskListViewContent } from '@/components/views/list/TaskListViewContent'
import { Alert } from '@/components/ui/Alert'

export default function ProjectListPage() {
  const projectId = Number(useParams().id)
  return (
    <PermissionGuard
      require="task:view"
      fallback={<Alert className="my-8">你没有查看项目任务列表的权限。</Alert>}
    >
      <TaskListViewContent projectId={projectId} />
    </PermissionGuard>
  )
}
