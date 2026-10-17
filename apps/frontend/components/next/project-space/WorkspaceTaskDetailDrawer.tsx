'use client'

import { CopyableCode } from '@/components/next/common/CopyableCode'
import { formatTaskCode } from '@aiproj/types'
import { TaskStepChecklist } from './TaskStepChecklist'
import * as React from 'react'
import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/Sheet'
import { usePermissions } from '@/hooks/use-permissions'
import { toast } from '@/components/ui/Toast'
import { memberOptionLabel, sortMembersForAssign } from '@/lib/next/member-options'
import { projectMembersApi, projectKeys, type ProjectMember } from '@/lib/api/projects'
import {
  taskKeys,
  tasksApi,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskInput,
} from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { optimisticPatchTask, restoreOptimisticTaskSnapshots } from '@/lib/optimistic-task-patch'
import { kanbanKeys } from '@/lib/api/kanban'
import { TASK_STATUS_LABELS } from '@/lib/task-status'
import { readTaskSteps } from '@/lib/next/task-steps'
import { TaskDependenciesPanel } from '@/components/tasks/TaskDependenciesPanel'
import { TaskExternalLinksPanel } from '@/components/views/tasks/TaskExternalLinksPanel'
import { NextLegacyThemeScope } from '@/components/ui/NextLegacyThemeScope'
import { VariantInput } from '@/components/locale/variant-field'

export const TASK_DETAIL_PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

export interface WorkspaceTaskDetailDrawerProps {
  projectId: number
  /** 项目编号（用于显示任务编号 `PROJ-5#128`；缺省用 `PROJ-{项目ID}`）。 */
  projectCode?: string | null
  taskId: number | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export interface DetailFormState {
  name: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string
  startDate: string
  endDate: string
  durationDays: string
  progressPercent: number
  description: string
}

const DEFAULT_FORM: DetailFormState = {
  name: '',
  status: 'not_started',
  priority: 'medium',
  assigneeId: '',
  startDate: '',
  endDate: '',
  durationDays: '',
  progressPercent: 0,
  description: '',
}

function formFromTask(task: Task): DetailFormState {
  return {
    name: task.name ?? '',
    status: task.status ?? 'not_started',
    priority: task.priority ?? 'medium',
    assigneeId:
      task.assigneeId !== null && task.assigneeId !== undefined ? String(task.assigneeId) : '',
    startDate: task.startDate ? task.startDate.slice(0, 10) : '',
    endDate: task.endDate ? task.endDate.slice(0, 10) : '',
    durationDays:
      task.durationDays !== null && task.durationDays !== undefined
        ? String(task.durationDays)
        : '',
    progressPercent: task.progressPercent ?? 0,
    description: task.description ?? '',
  }
}

/**
 * 服务端数据刷新时合并进表单：用户没动过的字段跟服务端走，动过的保留用户的输入。
 * 此前整份覆盖——打勾保存后一刷新，表单里没保存的修改就没了；反过来旧表单值又会在「保存修改」时覆盖新进度。
 */
export function mergeDetailForm(
  current: DetailFormState,
  baseline: DetailFormState | null,
  next: DetailFormState,
): DetailFormState {
  if (!baseline) return next
  const merged = { ...next }
  for (const key of Object.keys(next) as Array<keyof DetailFormState>) {
    if (current[key] !== baseline[key]) (merged as Record<string, unknown>)[key] = current[key]
  }
  return merged
}

function memberLabel(member: ProjectMember): string {
  return member.user?.fullName?.trim()
    ? member.user.fullName
    : (member.user?.email ?? `成员 #${member.userId}`)
}

/**
 * 单项目空间任务详情内敛抽屉组件（v3-ui-next-batch1-strategy-launch-tasks W4 · 4.1）。
 *
 * - 暗黑仪器风侧滑抽屉（max-w-xl），消除跳出单项目空间的独立页面；
 * - 头部展示任务编号、名称行内编辑、状态微标；
 * - 核心区支持优先级、负责人、工期排程、进度百分比调整；
 * - 内嵌 TaskDependenciesPanel（前后置依赖）与 TaskExternalLinksPanel（外部交付物关联）；
 * - 权限守卫：无编辑权限时编辑控件禁用/隐藏，保持只读安全。
 */
export function WorkspaceTaskDetailDrawer({
  projectId,
  projectCode = null,
  taskId,
  open: controlledOpen,
  onOpenChange,
}: WorkspaceTaskDetailDrawerProps) {
  const mobile = useMobileWorkspace()
  const drawerRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!mobile) return
    const viewport = window.visualViewport
    const update = () => {
      drawerRef.current?.style.setProperty(
        '--mobile-detail-height',
        `${viewport?.height ?? window.innerHeight}px`,
      )
      drawerRef.current?.style.setProperty('--mobile-detail-top', `${viewport?.offsetTop ?? 0}px`)
    }
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [mobile])
  const [section, setSection] = React.useState('execution')
  React.useEffect(() => {
    setSection('execution')
  }, [taskId])
  const queryClient = useQueryClient()
  // 走项目权限作用域：项目经理等项目角色的管理权限在此生效
  const { can: hasPermission } = usePermissions()
  const canEdit = hasPermission('task:update') || hasPermission('task:update:self')
  // 排期（开始 / 截止 / 工期）只有项目管理者能改；成员推进自己的状态与进度
  const canEditSchedule = hasPermission('task:update')
  const canAssign = hasPermission('task:assign')

  const isOpen = controlledOpen !== undefined ? controlledOpen : taskId !== null

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      onOpenChange?.(nextOpen)
    },
    [onOpenChange],
  )

  const {
    data: task,
    isLoading: isTaskLoading,
    isError: isTaskError,
  } = useQuery({
    queryKey: taskKeys.detail(projectId, taskId ?? 0),
    queryFn: () => tasksApi.get(projectId, taskId!),
    enabled: Boolean(isOpen && taskId && taskId > 0),
  })

  const { data: members = [] } = useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectMembersApi.list(projectId),
    enabled: Boolean(isOpen && projectId > 0),
  })

  const [form, setForm] = React.useState<DetailFormState>(DEFAULT_FORM)
  const [saveSuccess, setSaveSuccess] = React.useState(false)
  // 上一次从服务端同步进表单的值：判断哪些字段用户改过
  const baselineRef = React.useRef<DetailFormState | null>(null)
  const baselineTaskId = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!task) return
    const next = formFromTask(task)
    // 换了一张任务：整份重置
    const sameTask = baselineTaskId.current === task.id
    // 先取出旧基线：setForm 的更新函数在渲染时才执行，那时 baselineRef 已被下一行换成新值
    const previous = baselineRef.current
    setForm((current) => (sameTask ? mergeDetailForm(current, previous, next) : next))
    baselineRef.current = next
    baselineTaskId.current = task.id
  }, [task])

  // 打勾的结果（进度 / 状态）立即进表单并视为已同步：「保存修改」不会再拿旧进度覆盖
  const handleStepsChange = React.useCallback((local: Task) => {
    setForm((current) => ({
      ...current,
      progressPercent: local.progressPercent ?? current.progressPercent,
      status: local.status,
    }))
    if (baselineRef.current) {
      baselineRef.current = {
        ...baselineRef.current,
        progressPercent: local.progressPercent ?? baselineRef.current.progressPercent,
        status: local.status,
      }
    }
  }, [])
  const hasSteps = task ? readTaskSteps(task).steps.length > 0 : false

  const updateMutation = useMutation({
    mutationFn: (input: UpdateTaskInput) => tasksApi.updateWithWarnings(projectId, taskId!, input),
    onMutate: async (input) => {
      // 乐观上屏：远端库慢（保存要数秒）时看板 / 列表 / 抽屉立即反映改动，失败在 onError 回滚
      await queryClient.cancelQueries({ queryKey: taskKeys.all })
      await queryClient.cancelQueries({ queryKey: kanbanKeys.all })
      const snapshots = taskId ? optimisticPatchTask(queryClient, projectId, taskId, input) : []
      return { snapshots }
    },
    onError: (_error, _input, context) => {
      restoreOptimisticTaskSnapshots(queryClient, context?.snapshots)
    },
    onSuccess: async (result) => {
      for (const warning of result?.warnings ?? []) {
        toast({ variant: 'warning', title: '请注意', description: warning, duration: 8000 })
      }
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      await invalidateTaskQueries(queryClient, projectId)
    },
  })

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!taskId || !canEdit || updateMutation.isPending) return

    // 只提交真正改动的字段：未改负责人 / 排期时不带这些字段，
    // 否则成员只改进度也会被当成「改指派 / 改排期」而被拒绝
    const payload: UpdateTaskInput = {}
    const name = form.name.trim()
    if (name && name !== task?.name) payload.name = name
    // 与上次同步的值比较（打勾刚改过的进度 / 状态不算用户改动）
    const base = baselineRef.current ?? (task ? formFromTask(task) : DEFAULT_FORM)
    if (form.status !== base.status) payload.status = form.status
    if (form.priority !== task?.priority) payload.priority = form.priority
    const assigneeId = form.assigneeId ? Number(form.assigneeId) : null
    if (assigneeId !== (task?.assigneeId ?? null)) payload.assigneeId = assigneeId
    if (form.startDate && form.startDate !== (task?.startDate ?? '').slice(0, 10)) {
      payload.startDate = form.startDate
    }
    if (form.endDate && form.endDate !== (task?.endDate ?? '').slice(0, 10)) {
      payload.endDate = form.endDate
    }
    const duration = form.durationDays ? Number(form.durationDays) : undefined
    if (duration !== undefined && duration !== (task?.durationDays ?? undefined)) {
      payload.durationDays = duration
    }
    const progress = Number(form.progressPercent)
    if (!hasSteps && progress !== base.progressPercent) payload.progressPercent = progress
    const description = form.description.trim()
    if (description !== (task?.description ?? '').trim()) payload.description = description || null
    if (Object.keys(payload).length === 0) {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      return
    }

    await updateMutation.mutateAsync(payload)
  }

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        ref={(node) => {
          drawerRef.current = node
          if (node && mobile) {
            node.style.setProperty(
              '--mobile-detail-height',
              `${window.visualViewport?.height ?? window.innerHeight}px`,
            )
            node.style.setProperty(
              '--mobile-detail-top',
              `${window.visualViewport?.offsetTop ?? 0}px`,
            )
          }
        }}
        style={
          mobile
            ? {
                top: 'var(--mobile-detail-top, 0px)',
                height: 'var(--mobile-detail-height, 100dvh)',
                bottom: 'auto',
              }
            : undefined
        }
        hideClose
        data-next-track
        data-workspace-task-detail-drawer
        data-testid="workspace-task-detail-drawer"
        className="flex h-dvh w-full max-w-xl flex-col overflow-hidden border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0 text-[var(--nx-text-primary)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--nx-border-hairline)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span data-task-detail-id data-testid="task-detail-id">
              <CopyableCode
                code={formatTaskCode({ id: projectId, code: projectCode }, taskId ?? 0)}
                className="bg-[var(--nx-bg-0)]"
              />
            </span>
            <SheetTitle className="text-base font-semibold text-[var(--nx-text-primary)]">
              任务详情
            </SheetTitle>
          </div>
          <SheetClose
            data-task-detail-close
            data-testid="task-detail-close"
            className="rounded p-1 text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">关闭详情抽屉</span>
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">
          单项目空间任务详情内敛抽屉，支持基本属性配置、前后置依赖维护与外部交付物关联。
        </SheetDescription>

        {mobile ? (
          <div
            role="group"
            aria-label="任务详情分区"
            className="grid shrink-0 grid-cols-3 border-b border-[var(--nx-border-hairline)] p-2"
          >
            {(
              [
                ['execution', '执行'],
                ['schedule', '排期'],
                ['links', '关联'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={section === id}
                onClick={() => setSection(id)}
                className={`min-h-11 rounded-lg text-sm ${section === id ? 'bg-[var(--nx-bg-0)] text-[var(--nx-accent)]' : 'text-[var(--nx-text-secondary)]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <div
          data-task-detail-body
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-6"
        >
          {isTaskLoading ? (
            <div
              data-task-detail-loading
              data-testid="task-detail-loading"
              className="py-12 flex flex-col items-center justify-center gap-3 text-[var(--nx-text-muted)]"
            >
              <Loader2 className="h-6 w-6 animate-spin text-[var(--nx-accent)]" />
              <span className="text-xs">正在载入任务详情...</span>
            </div>
          ) : isTaskError || !task ? (
            <div role="alert" className="py-8 text-center text-sm text-[var(--nx-status-danger)]">
              任务数据加载失败或该任务已被移除。
            </div>
          ) : (
            <div className="mt-4 space-y-6">
              <form id="workspace-task-detail-form" onSubmit={handleSubmit} className="space-y-4">
                <section hidden={mobile && section !== 'execution'} className="space-y-4">
                  {task && (task.status === 'blocked' || task.status === 'on_hold') ? (
                    <div
                      data-task-detail-blocked
                      role="note"
                      className="rounded-md border border-[var(--nx-status-danger)]/40 bg-[var(--nx-status-danger)]/10 px-3 py-2 text-xs text-[var(--nx-text-primary)]"
                    >
                      <span className="font-medium text-[var(--nx-status-danger)]">
                        {task.status === 'blocked' ? '受阻' : '已暂停'}
                      </span>
                      ：
                      {typeof task.customFields?.blockedReason === 'string' &&
                      task.customFields.blockedReason
                        ? task.customFields.blockedReason
                        : '未填写原因'}
                    </div>
                  ) : null}
                  {/* 任务名称 */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="task-detail-name"
                      className="text-xs text-[var(--nx-text-secondary)]"
                    >
                      任务名称
                    </label>
                    {canEdit ? (
                      // 任务名多半由 AI 生成：按简繁切换显示，改完转回简体存储
                      <VariantInput
                        id="task-detail-name"
                        data-task-detail-name
                        data-testid="task-detail-name"
                        value={form.name}
                        onValueChange={(name) => setForm((prev) => ({ ...prev, name }))}
                        className="w-full h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                        placeholder="输入任务名称"
                      />
                    ) : (
                      <div
                        data-task-detail-name-readonly
                        data-testid="task-detail-name-readonly"
                        className="text-sm font-medium text-[var(--nx-text-primary)] py-1.5"
                      >
                        {form.name}
                      </div>
                    )}
                  </div>

                  {/* 状态与优先级 */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="task-detail-status"
                        className="text-xs text-[var(--nx-text-secondary)]"
                      >
                        状态
                      </label>
                      {canEdit ? (
                        <select
                          id="task-detail-status"
                          data-task-detail-status
                          data-testid="task-detail-status"
                          value={form.status}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, status: e.target.value as TaskStatus }))
                          }
                          className="w-full h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                        >
                          {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div
                          data-task-detail-status-readonly
                          data-testid="task-detail-status-readonly"
                          className="text-sm text-[var(--nx-text-primary)] py-1.5"
                        >
                          {TASK_STATUS_LABELS[form.status] ?? form.status}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="task-detail-priority"
                        className="text-xs text-[var(--nx-text-secondary)]"
                      >
                        优先级
                      </label>
                      {canEdit ? (
                        <select
                          id="task-detail-priority"
                          data-task-detail-priority
                          data-testid="task-detail-priority"
                          value={form.priority}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              priority: e.target.value as TaskPriority,
                            }))
                          }
                          className="w-full h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                        >
                          {Object.entries(TASK_DETAIL_PRIORITY_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div
                          data-task-detail-priority-readonly
                          data-testid="task-detail-priority-readonly"
                          className="text-sm text-[var(--nx-text-primary)] py-1.5"
                        >
                          {TASK_DETAIL_PRIORITY_LABELS[form.priority] ?? form.priority}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 负责人 */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="task-detail-assignee"
                      className="text-xs text-[var(--nx-text-secondary)]"
                    >
                      负责人
                    </label>
                    {canAssign ? (
                      <select
                        id="task-detail-assignee"
                        data-task-detail-assignee
                        data-testid="task-detail-assignee"
                        value={form.assigneeId}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, assigneeId: e.target.value }))
                        }
                        className="w-full h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                      >
                        <option value="">未指派</option>
                        {sortMembersForAssign(members).map((member) => (
                          <option key={member.id} value={String(member.userId)}>
                            {memberOptionLabel(member)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div
                        data-task-detail-assignee-readonly
                        data-testid="task-detail-assignee-readonly"
                        className="text-sm text-[var(--nx-text-primary)] py-1.5"
                      >
                        {members.find((m) => String(m.userId) === form.assigneeId)
                          ? memberLabel(members.find((m) => String(m.userId) === form.assigneeId)!)
                          : '未指派'}
                      </div>
                    )}
                  </div>

                  {/* 工期排程 */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="task-detail-description"
                      className="text-sm text-[var(--nx-text-secondary)]"
                    >
                      任务说明
                    </label>
                    <textarea
                      id="task-detail-description"
                      value={form.description}
                      readOnly={!canEdit}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, description: event.target.value }))
                      }
                      rows={4}
                      className="w-full rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 text-sm"
                    />
                  </div>
                </section>
                <section hidden={mobile && section !== 'schedule'} className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="task-detail-start-date"
                        className="text-xs text-[var(--nx-text-secondary)]"
                      >
                        开始日期
                      </label>
                      {canEditSchedule ? (
                        <input
                          id="task-detail-start-date"
                          data-task-detail-start-date
                          data-testid="task-detail-start-date"
                          type="date"
                          value={form.startDate}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, startDate: e.target.value }))
                          }
                          className="w-full h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                        />
                      ) : (
                        <div className="text-xs text-[var(--nx-text-primary)] py-2">
                          {form.startDate || '-'}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="task-detail-end-date"
                        className="text-xs text-[var(--nx-text-secondary)]"
                      >
                        截止日期
                      </label>
                      {canEditSchedule ? (
                        <input
                          id="task-detail-end-date"
                          data-task-detail-end-date
                          data-testid="task-detail-end-date"
                          type="date"
                          value={form.endDate}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, endDate: e.target.value }))
                          }
                          className="w-full h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                        />
                      ) : (
                        <div className="text-xs text-[var(--nx-text-primary)] py-2">
                          {form.endDate || '-'}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="task-detail-duration"
                        className="text-xs text-[var(--nx-text-secondary)]"
                      >
                        工期 (天)
                      </label>
                      {canEditSchedule ? (
                        <input
                          id="task-detail-duration"
                          data-task-detail-duration
                          data-testid="task-detail-duration"
                          type="number"
                          min={1}
                          value={form.durationDays}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, durationDays: e.target.value }))
                          }
                          className="w-full h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                        />
                      ) : (
                        <div className="text-xs text-[var(--nx-text-primary)] py-2">
                          {form.durationDays ? `${form.durationDays} 天` : '-'}
                        </div>
                      )}
                    </div>
                  </div>

                  {canEdit && !canEditSchedule ? (
                    <p
                      data-task-detail-schedule-hint
                      className="-mt-2 text-[11px] text-[var(--nx-text-muted)]"
                    >
                      排期由项目经理调整；需要延期请联系项目经理或提交变更申请。
                    </p>
                  ) : null}
                </section>
                <section hidden={mobile && section !== 'execution'} className="space-y-4">
                  {/* 执行步骤清单：逐项打勾，进度按勾选比例自动更新 */}
                  <TaskStepChecklist
                    projectId={projectId}
                    task={task}
                    canEdit={canEdit}
                    onLocalChange={handleStepsChange}
                  />

                  {/* 进度百分比 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="task-detail-progress"
                        className="text-xs text-[var(--nx-text-secondary)]"
                      >
                        完成进度
                      </label>
                      <span className="text-xs font-mono text-[var(--nx-text-muted)]">
                        {form.progressPercent}%
                      </span>
                    </div>
                    {hasSteps ? (
                      <p
                        data-task-detail-progress-auto
                        className="text-[11px] text-[var(--nx-text-muted)]"
                      >
                        按上面执行步骤的勾选比例自动计算
                      </p>
                    ) : null}
                    {canEdit && !hasSteps ? (
                      <input
                        id="task-detail-progress"
                        data-task-detail-progress
                        data-testid="task-detail-progress"
                        type="range"
                        min={0}
                        max={100}
                        value={form.progressPercent}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, progressPercent: Number(e.target.value) }))
                        }
                        className="w-full accent-[var(--nx-accent)]"
                      />
                    ) : (
                      <div className="h-2 w-full rounded-full bg-[var(--nx-bg-0)] overflow-hidden">
                        <div
                          className="h-full bg-[var(--nx-accent)]"
                          style={{ width: `${form.progressPercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                </section>
                {/* 提交按钮与反馈 */}
                {canEdit ? (
                  <div className={mobile ? 'hidden' : 'flex items-center justify-between pt-2'}>
                    <button
                      type="submit"
                      data-task-detail-submit
                      data-testid="task-detail-submit"
                      disabled={updateMutation.isPending}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-50 cursor-pointer"
                    >
                      {updateMutation.isPending ? '保存中...' : '保存修改'}
                    </button>
                    {saveSuccess ? (
                      <span
                        data-task-detail-saved-toast
                        data-testid="task-detail-saved-toast"
                        className="text-xs text-[var(--nx-status-success)]"
                      >
                        ✓ 已保存
                      </span>
                    ) : null}
                    {updateMutation.isError ? (
                      <span className="text-xs text-[var(--nx-status-danger)]">
                        {(updateMutation.error as { message?: string }).message ?? '保存失败'}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div
                    data-readonly-hint
                    data-testid="readonly-hint"
                    className="text-xs text-[var(--nx-text-muted)] pt-1"
                  >
                    当前处于只读模式（缺少编辑权限）
                  </div>
                )}
              </form>

              {/* 前后置依赖与外部链接面板 */}
              {taskId ? (
                <NextLegacyThemeScope>
                  <div
                    hidden={mobile && section !== 'links'}
                    className="space-y-6 pt-4 border-t border-[var(--nx-border-hairline)]"
                  >
                    <section aria-label="前后置依赖">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--nx-text-secondary)] mb-2">
                        前后置依赖
                      </h4>
                      <TaskDependenciesPanel
                        projectId={projectId}
                        taskId={taskId}
                        canEdit={canEdit}
                      />
                    </section>

                    <section aria-label="外部交付物">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--nx-text-secondary)] mb-2">
                        外部交付物关联
                      </h4>
                      <TaskExternalLinksPanel projectId={projectId} taskId={taskId} />
                    </section>
                  </div>
                </NextLegacyThemeScope>
              ) : null}
            </div>
          )}
        </div>
        {mobile && task && canEdit ? (
          <footer
            data-mobile-task-save
            className="shrink-0 border-t border-[var(--nx-border-hairline)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]"
          >
            {updateMutation.isError ? (
              <p role="alert" className="mb-2 text-sm text-[var(--nx-status-danger)]">
                {(updateMutation.error as Error)?.message ?? '保存失败'}
              </p>
            ) : null}
            <button
              type="submit"
              form="workspace-task-detail-form"
              disabled={updateMutation.isPending}
              className="min-h-12 w-full rounded-xl bg-[var(--nx-accent)] px-4 text-base font-medium text-[var(--nx-space-bg)] disabled:opacity-50"
            >
              {updateMutation.isPending
                ? '保存中…'
                : saveSuccess
                  ? '已保存 · 保存修改'
                  : '保存修改'}
            </button>
          </footer>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
