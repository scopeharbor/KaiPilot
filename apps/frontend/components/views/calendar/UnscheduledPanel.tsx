'use client'

import { useState } from 'react'
import { CalendarX2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { tasksApi, taskKeys } from '@/lib/api/tasks'
import { EmptyState } from '@/components/ui/EmptyState'
import { TaskDetailDrawer } from '@/components/views/tasks/TaskDetailDrawer'
import { cn } from '@/lib/utils'

interface UnscheduledPanelProps {
  count: number
  projectId: number
}

/**
 * 无日期任务侧栏/面板。
 * 展示没有开始和结束日期的任务列表，提供详情入口。
 * 不创建平行数据模型 —— 只读视图复用工位任务详情抽屉。
 */
export function UnscheduledPanel({ count, projectId }: UnscheduledPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const { data: tasks, isLoading } = useQuery({
    queryKey: [...taskKeys.all, 'unscheduled', projectId],
    queryFn: () =>
      tasksApi.list(projectId, {
        sort: '-createdAt',
        perPage: 50,
      }),
    enabled: expanded && isAuthenticated,
  })

  // 过滤出无日期任务
  const unscheduledTasks = (tasks?.data ?? []).filter((t) => !t.startDate && !t.endDate)

  if (count === 0) return null

  return (
    <>
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <button
          className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={`无日期任务，共 ${count} 项`}
        >
          <div className="flex items-center gap-2">
            <CalendarX2 className="h-4 w-4 text-muted-foreground" />
            <span>无日期任务（{count}）</span>
          </div>
          <span className="text-xs text-muted-foreground">{expanded ? '收起' : '展开'}</span>
        </button>

        {expanded && (
          <div
            className="border-t px-4 py-2 max-h-60 overflow-y-auto"
            role="list"
            aria-label="无日期任务列表"
          >
            {isLoading && (
              <div className="py-4 text-center text-sm text-muted-foreground">加载中…</div>
            )}
            {!isLoading && unscheduledTasks.length === 0 && (
              <EmptyState
                icon={CalendarX2}
                title="暂无无日期任务"
                description="所有任务都已设置开始或结束日期。"
              />
            )}
            {!isLoading &&
              unscheduledTasks.map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer',
                    'hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                  onClick={() => setSelectedTaskId(task.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSelectedTaskId(task.id)
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`打开任务详情：${task.name}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                  <span className="truncate flex-1">{task.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {task.status === 'not_started' && '未开始'}
                    {task.status === 'in_progress' && '进行中'}
                    {task.status === 'completed' && '已完成'}
                    {task.status === 'blocked' && '已阻塞'}
                    {task.status === 'on_hold' && '已挂起'}
                    {task.status === 'cancelled' && '已取消'}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      <TaskDetailDrawer
        projectId={projectId}
        taskId={selectedTaskId}
        onOpenChange={(open) => !open && setSelectedTaskId(null)}
      />
    </>
  )
}
