'use client'

import { AiTaskPlacementCard } from './AiTaskPlacementCard'
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/Sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'
import { usePermissions } from '@/hooks/use-permissions'
import { projectKeys, projectMembersApi, type ProjectMember } from '@/lib/api/projects'
import {
  tasksApi,
  type CreateTaskInput,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { TASK_STATUS_LABELS } from '@/lib/task-status'

export const MANUAL_TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

export const MANUAL_TASK_TYPE_LABELS: Record<TaskType, string> = {
  task: '任务',
  milestone: '里程碑',
  summary: '汇总',
  deliverable: '交付物',
}

export interface ManualTaskCreateDrawerProps {
  projectId: number
  /**
   * 项目成员数据源（W4 装配：容器已通过 projectMembersApi.list 加载时传入，
   * 与内部回退查询共用 projectKeys.members 缓存键，不会重复请求）。
   */
  members?: ProjectMember[]
  /** 受控展开（W4 装配时可接管）；缺省组件内部自管理。 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 创建成功回调（W4 装配：通知看板刷新）。 */
  onCreated?: (task: Task) => void
}

interface ManualTaskFormState {
  name: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  taskType: TaskType
  startDate: string
  endDate: string
  durationDays: string
  estimatedHours: string
  assigneeId: string
  reviewerId: string
  wbsNodeId: string
}

const EMPTY_FORM: ManualTaskFormState = {
  name: '',
  description: '',
  status: 'not_started',
  priority: 'medium',
  taskType: 'task',
  startDate: '',
  endDate: '',
  durationDays: '',
  estimatedHours: '',
  assigneeId: '',
  reviewerId: '',
  wbsNodeId: '',
}

function memberLabel(member: ProjectMember): string {
  return member.user?.fullName?.trim()
    ? member.user.fullName
    : (member.user?.email ?? `成员 #${member.userId}`)
}

/**
 * 手动新建任务抽屉（v3-ui-next-project-space D6 / 任务 3.5，D7 第二入口）。
 *
 * - 触发电钮常驻（`data-manual-task-create-trigger`），无 `task:create` 权限置灰
 *   禁用并悬停提示（RL-06 展示层守卫，服务端 RBAC 仍是最终边界）；
 * - 表单字段严格对齐 `CreateTaskInput`（RL-04：双入口共用同一模型与 `tasksApi.create`）；
 * - 提交前客户端必填校验（名称缺失提示「请输入任务名称」，零网络请求）；
 * - 成功提交关闭抽屉、重置表单并 `invalidateTaskQueries` 刷新看板。
 */
export function ManualTaskCreateDrawer({
  projectId,
  members: membersProp,
  open,
  onOpenChange,
  onCreated,
}: ManualTaskCreateDrawerProps) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const canCreate = can('task:create')

  const [internalOpen, setInternalOpen] = React.useState(false)
  // 默认「AI 帮我建」：一句话交给 AI 补全；需要逐项精确配置时切到「手动填写」（2026-09-29）
  const [mode, setMode] = React.useState<'ai' | 'manual'>('ai')
  const isOpen = open ?? internalOpen
  const setOpen = (next: boolean) => {
    setInternalOpen(next)
    onOpenChange?.(next)
  }

  const [form, setForm] = React.useState<ManualTaskFormState>(EMPTY_FORM)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  // 成员数据源：优先消费容器传入（共享 projectKeys.members 缓存键，零重复请求）。
  const membersQuery = useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectMembersApi.list(projectId),
    enabled: isOpen && membersProp === undefined && canCreate,
  })
  const members = membersProp ?? membersQuery.data ?? []

  const setField = <K extends keyof ManualTaskFormState>(key: K, value: ManualTaskFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (key === 'name') setNameError(null)
    setServerError(null)
  }

  const toCreateInput = (): CreateTaskInput => ({
    name: form.name.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    status: form.status,
    priority: form.priority,
    taskType: form.taskType,
    ...(form.startDate === '' ? {} : { startDate: form.startDate }),
    ...(form.endDate === '' ? {} : { endDate: form.endDate }),
    ...(form.durationDays === '' ? {} : { durationDays: Number(form.durationDays) }),
    ...(form.estimatedHours === '' ? {} : { estimatedHours: Number(form.estimatedHours) }),
    ...(form.assigneeId === '' ? {} : { assigneeId: Number(form.assigneeId) }),
    ...(form.reviewerId === '' ? {} : { reviewerId: Number(form.reviewerId) }),
    ...(form.wbsNodeId === '' ? {} : { wbsNodeId: Number(form.wbsNodeId) }),
  })

  const submit = async () => {
    if (!canCreate || submitting) return
    if (form.name.trim() === '') {
      setNameError('请输入任务名称')
      return
    }
    setSubmitting(true)
    setServerError(null)
    try {
      const task = await tasksApi.create(projectId, toCreateInput())
      await invalidateTaskQueries(queryClient, projectId)
      onCreated?.(task)
      setForm(EMPTY_FORM)
      setNameError(null)
      setOpen(false)
    } catch (cause) {
      setServerError(cause instanceof Error ? cause.message : '创建任务失败，请稍后重试')
      setSubmitting(false)
    }
  }

  const trigger = (
    <button
      type="button"
      data-manual-task-create-trigger
      disabled={!canCreate}
      onClick={() => setOpen(true)}
      aria-label="手动新建任务"
      aria-disabled={!canCreate}
      title={!canCreate ? '你没有在该项目中创建任务的权限' : undefined}
      className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden />
      手动新建
    </button>
  )

  return (
    <>
      {canCreate ? (
        trigger
      ) : (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{trigger}</span>
            </TooltipTrigger>
            <TooltipContent
              id="manual-task-create-blocked-tip"
              className="border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] text-[var(--nx-text-secondary)]"
            >
              你没有在该项目中创建任务的权限
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent
          data-next-track
          className="border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-[var(--nx-text-primary)] sm:p-6"
        >
          <SheetTitle
            data-manual-task-drawer-title
            className="pr-12 text-base font-semibold text-[var(--nx-text-primary)]"
          >
            手动新建任务
          </SheetTitle>
          <SheetDescription className="text-xs text-[var(--nx-text-muted)]">
            {mode === 'ai'
              ? '用一两句话说说要做什么，AI 帮你补成任务卡；不满意可以继续让它改，或切到「手动填写」。'
              : '精确配置完整任务属性（与任务创建接口字段完全对齐）。'}
          </SheetDescription>

          <div
            role="tablist"
            aria-label="新建方式"
            className="mt-3 flex w-fit rounded-md border border-[var(--nx-border-hairline)] p-0.5 text-xs"
          >
            {(
              [
                ['ai', 'AI 帮我建'],
                ['manual', '手动填写'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                data-manual-task-mode={value}
                onClick={() => setMode(value)}
                className={
                  mode === value
                    ? 'rounded bg-[var(--nx-accent)] px-3 py-1 font-medium text-[var(--nx-space-bg)]'
                    : 'rounded px-3 py-1 text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'ai' ? (
            <div data-manual-task-ai className="mt-4">
              <AiTaskPlacementCard
                projectId={projectId}
                columnId="pending"
                onClose={() => setOpen(false)}
                onCreated={(task) => onCreated?.(task)}
              />
            </div>
          ) : (
            <form
              data-manual-task-form
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
              className="mt-5 flex flex-col gap-4 overflow-y-auto px-1 pb-6 text-sm"
            >
              {/* 名称（必填） */}
              <label className="flex flex-col gap-1.5" htmlFor="manual-task-name">
                <span className="text-xs text-[var(--nx-text-secondary)]">
                  任务名称 <span className="text-[var(--nx-status-danger)]">*</span>
                </span>
                <input
                  id="manual-task-name"
                  data-manual-task-name
                  value={form.name}
                  maxLength={255}
                  onChange={(event) => setField('name', event.target.value)}
                  placeholder="例如：跨系统联调验收"
                  aria-invalid={nameError !== null}
                  aria-describedby={nameError !== null ? 'manual-task-name-error' : undefined}
                  className={`h-9 rounded-md border bg-[var(--nx-bg-0)] px-2.5 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--nx-border-focus)] ${
                    nameError !== null
                      ? 'border-[var(--nx-status-danger)]'
                      : 'border-[var(--nx-border-hairline)]'
                  }`}
                />
                {nameError !== null && (
                  <span
                    id="manual-task-name-error"
                    role="alert"
                    data-manual-task-name-error
                    className="text-xs text-[var(--nx-status-danger)]"
                  >
                    {nameError}
                  </span>
                )}
              </label>

              {/* 描述 */}
              <label className="flex flex-col gap-1.5" htmlFor="manual-task-description">
                <span className="text-xs text-[var(--nx-text-secondary)]">详细描述</span>
                <textarea
                  id="manual-task-description"
                  data-manual-task-description
                  rows={3}
                  value={form.description}
                  onChange={(event) => setField('description', event.target.value)}
                  placeholder="任务背景与验收要点（可选）"
                  className="resize-none rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* 状态 */}
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-status">
                  <span className="text-xs text-[var(--nx-text-secondary)]">初始状态</span>
                  <select
                    id="manual-task-status"
                    data-manual-task-status
                    value={form.status}
                    onChange={(event) => setField('status', event.target.value as TaskStatus)}
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  >
                    {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* 优先级 */}
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-priority">
                  <span className="text-xs text-[var(--nx-text-secondary)]">优先级</span>
                  <select
                    id="manual-task-priority"
                    data-manual-task-priority
                    value={form.priority}
                    onChange={(event) => setField('priority', event.target.value as TaskPriority)}
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  >
                    {Object.entries(MANUAL_TASK_PRIORITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* 任务类型 */}
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-type">
                  <span className="text-xs text-[var(--nx-text-secondary)]">任务类型</span>
                  <select
                    id="manual-task-type"
                    data-manual-task-type
                    value={form.taskType}
                    onChange={(event) => setField('taskType', event.target.value as TaskType)}
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  >
                    {Object.entries(MANUAL_TASK_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* WBS 节点 */}
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-wbs-node">
                  <span className="text-xs text-[var(--nx-text-secondary)]">WBS 节点 ID</span>
                  <input
                    id="manual-task-wbs-node"
                    data-manual-task-wbs-node
                    type="number"
                    min={1}
                    value={form.wbsNodeId}
                    onChange={(event) => setField('wbsNodeId', event.target.value)}
                    placeholder="可选"
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-start-date">
                  <span className="text-xs text-[var(--nx-text-secondary)]">计划开始日期</span>
                  <input
                    id="manual-task-start-date"
                    data-manual-task-start-date
                    type="date"
                    value={form.startDate}
                    onChange={(event) => setField('startDate', event.target.value)}
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-end-date">
                  <span className="text-xs text-[var(--nx-text-secondary)]">计划结束日期</span>
                  <input
                    id="manual-task-end-date"
                    data-manual-task-end-date
                    type="date"
                    value={form.endDate}
                    onChange={(event) => setField('endDate', event.target.value)}
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-duration">
                  <span className="text-xs text-[var(--nx-text-secondary)]">预估工期（天）</span>
                  <input
                    id="manual-task-duration"
                    data-manual-task-duration
                    type="number"
                    min={1}
                    value={form.durationDays}
                    onChange={(event) => setField('durationDays', event.target.value)}
                    placeholder="可选"
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-hours">
                  <span className="text-xs text-[var(--nx-text-secondary)]">预估工时（小时）</span>
                  <input
                    id="manual-task-hours"
                    data-manual-task-hours
                    type="number"
                    min={1}
                    value={form.estimatedHours}
                    onChange={(event) => setField('estimatedHours', event.target.value)}
                    placeholder="可选"
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-assignee">
                  <span className="text-xs text-[var(--nx-text-secondary)]">负责人</span>
                  <select
                    id="manual-task-assignee"
                    data-manual-task-assignee
                    value={form.assigneeId}
                    disabled={members.length === 0}
                    onChange={(event) => setField('assigneeId', event.target.value)}
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
                  >
                    <option value="">未分配</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.userId}>
                        {memberLabel(member)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5" htmlFor="manual-task-reviewer">
                  <span className="text-xs text-[var(--nx-text-secondary)]">审核人</span>
                  <select
                    id="manual-task-reviewer"
                    data-manual-task-reviewer
                    value={form.reviewerId}
                    disabled={members.length === 0}
                    onChange={(event) => setField('reviewerId', event.target.value)}
                    className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
                  >
                    <option value="">未分配</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.userId}>
                        {memberLabel(member)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {serverError !== null && (
                <p
                  role="alert"
                  data-manual-task-server-error
                  className="text-xs text-[var(--nx-status-danger)]"
                >
                  {serverError}
                </p>
              )}

              <div className="mt-2 flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] pt-4">
                <button
                  type="button"
                  data-manual-task-cancel
                  disabled={submitting}
                  onClick={() => setOpen(false)}
                  className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  data-manual-task-submit
                  disabled={!canCreate || submitting}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/10 px-4 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  )}
                  保存创建
                </button>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

export default ManualTaskCreateDrawer
