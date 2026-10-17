'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet'
import { CopilotInlineTrigger } from '@/components/copilot/CopilotInlineTrigger'
import { taskKeys, tasksApi } from '@/lib/api/tasks'
import { projectKeys, projectMembersApi } from '@/lib/api/projects'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { useAuthStore } from '@/stores/auth-store'
import { TASK_STATUS_LABELS } from '@/lib/task-status'
import { isAgentAssignee, AGENT_ACTION_LABEL } from '@/types/agent-assignee'
import { CommentThread } from '@/components/views/comments/CommentThread'
import { TaskExternalLinksPanel } from '@/components/views/tasks/TaskExternalLinksPanel'

export function TaskDetailDrawer({
  projectId,
  taskId,
  onOpenChange,
}: {
  projectId: number
  taskId: number | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canAssign = hasPermission('task:update') || hasPermission('task:update:self')
  const detail = useQuery({
    queryKey: taskKeys.detail(projectId, taskId ?? 0),
    queryFn: () => tasksApi.get(projectId, taskId!),
    enabled: taskId !== null,
  })
  const members = useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectMembersApi.list(projectId),
    enabled: taskId !== null && canAssign,
  })
  const assign = useMutation({
    mutationFn: (assigneeId: number | null) => tasksApi.update(projectId, taskId!, { assigneeId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.detail(projectId, taskId ?? 0) })
      await invalidateTaskQueries(queryClient, projectId)
    },
  })

  return (
    <Sheet open={taskId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>{detail.data?.name ?? '任务详情'}</SheetTitle>
            {detail.data ? (
              <CopilotInlineTrigger
                entity={{
                  entityType: 'task',
                  entityId: detail.data.id,
                  label: detail.data.name,
                  projectId,
                }}
                size="icon"
                variant="ghost"
              />
            ) : null}
          </div>
          <SheetDescription>关闭后会保留当前看板筛选与滚动位置。</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 p-6">
          {detail.isLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </>
          ) : null}
          {detail.isError ? (
            <p className="rounded-[var(--radius-md)] bg-danger-bg p-4 text-sm text-danger">
              任务详情加载失败，请稍后重试。
            </p>
          ) : null}
          {detail.data ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="primary">{TASK_STATUS_LABELS[detail.data.status]}</Badge>
                <Badge variant="outline">进度 {detail.data.progressPercent}%</Badge>
                {/* v3-copilot-agent-as-assignee：agent 负责人显示 AI 标签 */}
                {isAgentAssignee(detail.data.assigneeType) ? (
                  <Badge variant="ai">
                    <Bot className="h-3 w-3" aria-hidden />
                    {AGENT_ACTION_LABEL}
                  </Badge>
                ) : null}
              </div>
              <section>
                <h3 className="text-sm font-medium text-gray-800">说明</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                  {detail.data.description || '暂无说明'}
                </p>
              </section>
              <dl className="grid grid-cols-2 gap-4 rounded-[var(--radius-md)] bg-gray-50 p-4 text-sm">
                <div>
                  <dt className="text-gray-500">负责人</dt>
                  <dd className="mt-1 font-medium text-gray-800">
                    {canAssign ? (
                      isAgentAssignee(detail.data.assigneeType) ? (
                        // v3-copilot-agent-as-assignee：agent 负责人不可从人类下拉选择
                        <span className="inline-flex items-center gap-1.5 text-ai">
                          <Bot className="h-4 w-4" aria-hidden />
                          {detail.data.agentAssignee?.name || 'AI'}（{AGENT_ACTION_LABEL}）
                        </span>
                      ) : (
                        <select
                          className="h-9 w-full rounded-[var(--radius-md)] border border-border bg-gray-0 px-2 text-sm text-gray-800 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
                          value={detail.data.assigneeId ?? ''}
                          disabled={assign.isPending}
                          onChange={(event) =>
                            assign.mutate(event.target.value ? Number(event.target.value) : null)
                          }
                          aria-label="指派负责人"
                        >
                          <option value="">未分配</option>
                          {/* v3-copilot-agent-as-assignee：从成员列表中过滤掉 agent */}
                          {(members.data ?? [])
                            .filter(
                              (member) =>
                                !('assigneeType' in member && member.assigneeType === 'agent'),
                            )
                            .map((member) => (
                              <option key={member.userId} value={member.userId}>
                                {member.user?.fullName ||
                                  member.user?.email ||
                                  `成员 #${member.userId}`}
                              </option>
                            ))}
                        </select>
                      )
                    ) : isAgentAssignee(detail.data.assigneeType) ? (
                      <span className="inline-flex items-center gap-1.5 text-ai">
                        <Bot className="h-4 w-4" aria-hidden />
                        {detail.data.agentAssignee?.name || 'AI'}（{AGENT_ACTION_LABEL}）
                      </span>
                    ) : (
                      detail.data.assignee?.fullName || detail.data.assignee?.email || '未分配'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">截止日期</dt>
                  <dd className="mt-1 font-medium text-gray-800">
                    {detail.data.endDate || '未设置'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">子任务</dt>
                  <dd className="mt-1 font-medium text-gray-800">
                    {detail.data.subtasks?.length ?? detail.data.subtaskCount ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">依赖</dt>
                  <dd className="mt-1 font-medium text-gray-800">
                    {detail.data.dependencyCount ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">评论</dt>
                  <dd className="mt-1 font-medium text-gray-800">
                    {detail.data.commentCount ?? 0}
                  </dd>
                </div>
              </dl>

              {/* 评论区 */}
              <CommentThread
                projectId={projectId}
                entityType="task"
                entityId={taskId!}
                taskId={taskId!}
              />

              {/* 外部链接 */}
              <TaskExternalLinksPanel projectId={projectId} taskId={taskId!} />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
