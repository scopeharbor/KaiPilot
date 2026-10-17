'use client'

import { useMemo, useState } from 'react'
import { Layers3, Trash2 } from 'lucide-react'
import type { ProjectMember } from '@/lib/api/projects'
import type { TaskBatchInput, TaskPriority, TaskStatus } from '@/lib/api/tasks'
import { usePermissions } from '@/hooks/use-permissions'
import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'

type BatchAction = TaskBatchInput['action']

const ACTION_LABELS: Record<BatchAction, string> = {
  update: '批量编辑',
  reassign: '重新指派',
  change_status: '变更状态',
  delete: '移入回收站',
}

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

export interface TaskBatchActionBarProps {
  selectedIds: number[]
  members: ProjectMember[]
  pending?: boolean
  onClear: () => void
  onExecute: (input: TaskBatchInput) => void
}

export function TaskBatchActionBar({
  selectedIds,
  members,
  pending = false,
  onClear,
  onExecute,
}: TaskBatchActionBarProps) {
  const { can, canAny } = usePermissions()
  const canUpdate = canAny(['task:update', 'task:update:self'])
  const canAssign = can('task:assign')
  const canDelete = can('task:delete')
  const availableActions = useMemo(
    () =>
      [
        ...(canUpdate ? (['change_status', 'update'] as const) : []),
        ...(canUpdate && canAssign ? (['reassign'] as const) : []),
        ...(canDelete ? (['delete'] as const) : []),
      ] satisfies BatchAction[],
    [canAssign, canDelete, canUpdate],
  )
  const [action, setAction] = useState<BatchAction>(availableActions[0] ?? 'change_status')
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<TaskStatus>('in_progress')
  const [assignee, setAssignee] = useState('unassigned')
  const [priority, setPriority] = useState<TaskPriority | 'unchanged'>('unchanged')
  const [reviewer, setReviewer] = useState('unchanged')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [progressPercent, setProgressPercent] = useState('')

  if (selectedIds.length === 0 || availableActions.length === 0) return null

  const submit = () => {
    if (action === 'delete') {
      onExecute({ action, taskIds: selectedIds })
    } else if (action === 'reassign') {
      onExecute({
        action,
        taskIds: selectedIds,
        data: { assigneeId: assignee === 'unassigned' ? null : Number(assignee) },
      })
    } else if (action === 'change_status') {
      onExecute({ action, taskIds: selectedIds, data: { status } })
    } else {
      onExecute({
        action,
        taskIds: selectedIds,
        data: {
          ...(priority !== 'unchanged' ? { priority } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(estimatedHours ? { estimatedHours: Number(estimatedHours) } : {}),
          ...(progressPercent ? { progressPercent: Number(progressPercent) } : {}),
          ...(reviewer !== 'unchanged'
            ? { reviewerId: reviewer === 'unassigned' ? null : Number(reviewer) }
            : {}),
        },
      })
    }
    setOpen(false)
  }

  const updateHasValue =
    priority !== 'unchanged' ||
    reviewer !== 'unchanged' ||
    Boolean(startDate || endDate || estimatedHours || progressPercent)

  return (
    <div
      className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-primary-200 bg-gray-0 p-3 shadow-[var(--shadow-md)] sm:flex-row sm:items-center"
      aria-label="任务批量操作"
    >
      <div className="flex min-w-36 items-center gap-2 text-sm font-medium text-gray-800">
        <Layers3 className="h-4 w-4 text-primary-500" aria-hidden />
        已选择 {selectedIds.length} 项
      </div>
      <Select value={action} onValueChange={(value) => setAction(value as BatchAction)}>
        <SelectTrigger className="sm:w-44" aria-label="批量动作">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableActions.map((item) => (
            <SelectItem key={item} value={item}>
              {ACTION_LABELS[item]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-1 justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClear}>
          取消选择
        </Button>
        <Button
          type="button"
          variant={action === 'delete' ? 'danger' : 'primary'}
          onClick={() => setOpen(true)}
        >
          {action === 'delete' ? <Trash2 className="h-4 w-4" aria-hidden /> : null}
          设置并执行
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {ACTION_LABELS[action]} · {selectedIds.length} 项
            </DialogTitle>
            <DialogDescription>
              系统会逐项处理；失败项不会回滚已经成功的任务，并会保留供你重试。
            </DialogDescription>
          </DialogHeader>

          {action === 'change_status' ? (
            <Field label="目标状态">
              <Select value={status} onValueChange={(value) => setStatus(value as TaskStatus)}>
                <SelectTrigger aria-label="目标状态">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {action === 'reassign' ? (
            <Field label="新负责人">
              <MemberSelect value={assignee} members={members} onChange={setAssignee} />
            </Field>
          ) : null}

          {action === 'update' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="优先级">
                <Select
                  value={priority}
                  onValueChange={(value) => setPriority(value as TaskPriority | 'unchanged')}
                >
                  <SelectTrigger aria-label="优先级">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unchanged">保持不变</SelectItem>
                    {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {canAssign ? (
                <Field label="审核人">
                  <MemberSelect
                    value={reviewer}
                    members={members}
                    onChange={setReviewer}
                    allowUnchanged
                  />
                </Field>
              ) : null}
              <Field label="计划开始">
                <Input
                  aria-label="计划开始"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </Field>
              <Field label="计划结束">
                <Input
                  aria-label="计划结束"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </Field>
              <Field label="预估工时">
                <Input
                  aria-label="预估工时"
                  type="number"
                  min={0}
                  value={estimatedHours}
                  onChange={(event) => setEstimatedHours(event.target.value)}
                />
              </Field>
              <Field label="进度（0–100）">
                <Input
                  aria-label="进度"
                  type="number"
                  min={0}
                  max={100}
                  value={progressPercent}
                  onChange={(event) => setProgressPercent(event.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {action === 'delete' ? (
            <p className="rounded-[var(--radius-md)] bg-danger-bg p-4 text-sm text-gray-700">
              任务将移入回收站，30 天内可恢复。含活动子任务的父任务会保留并报告失败。
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              返回
            </Button>
            <Button
              type="button"
              variant={action === 'delete' ? 'danger' : 'primary'}
              loading={pending}
              disabled={action === 'update' && !updateHasValue}
              onClick={submit}
            >
              确认处理 {selectedIds.length} 项
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function MemberSelect({
  value,
  members,
  onChange,
  allowUnchanged = false,
}: {
  value: string
  members: ProjectMember[]
  onChange: (value: string) => void
  allowUnchanged?: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="项目成员">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowUnchanged ? <SelectItem value="unchanged">保持不变</SelectItem> : null}
        <SelectItem value="unassigned">不指派</SelectItem>
        {members.map((member) => (
          <SelectItem key={member.userId} value={String(member.userId)}>
            {member.user?.fullName || member.user?.email || `用户 ${member.userId}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
