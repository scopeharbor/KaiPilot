'use client'

import { useMemo, useState } from 'react'
import { Flag, Pencil, Plus, Trash2 } from 'lucide-react'
import { z } from 'zod'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormSubmit,
  useForm,
  zodResolver,
} from '@/components/forms'
import { Button } from '@/components/ui/Button'
import { Badge, type BadgeProps } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/Sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useCreateMilestone,
  useDeleteMilestone,
  useMilestones,
  useUpdateMilestone,
} from '@/hooks/use-milestones'
import type { Milestone, MilestoneStatus } from '@/lib/api/milestones'

/** 状态展示元数据：Badge 变体 + 中文标签（双通道，不以颜色单独承载信息）。 */
const STATUS_META: Record<MilestoneStatus, { label: string; variant: BadgeProps['variant'] }> = {
  not_started: { label: '未开始', variant: 'neutral' },
  planned: { label: '计划中', variant: 'primary' },
  at_risk: { label: '有风险', variant: 'warning' },
  achieved: { label: '已达成', variant: 'success' },
  missed: { label: '已逾期', variant: 'danger' },
}

/** 人工可设定的状态（at_risk/missed 由系统按日期推导，不在表单直选）。 */
const HUMAN_STATUS_OPTIONS: MilestoneStatus[] = ['not_started', 'planned', 'achieved']

const milestoneFormSchema = z.object({
  name: z.string().trim().min(1, '请输入里程碑名称').max(255, '名称不能超过 255 个字符'),
  description: z.string().max(2000, '描述不能超过 2000 个字符').optional(),
  status: z.enum(['not_started', 'planned', 'at_risk', 'achieved', 'missed']),
  plannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, '请选择有效日期')
    .optional()
    .or(z.literal('')),
})

type MilestoneFormValues = z.infer<typeof milestoneFormSchema>

type Editing = { mode: 'create' } | { mode: 'edit'; milestone: Milestone } | null

export interface MilestoneManagerProps {
  projectId: number
}

/**
 * 甘特工具栏「里程碑」入口 + 管理抽屉（task 5.2/5.3）。
 * 列表 + 新建/编辑/删除；无写权限时降级只读（隐藏写入口）。展示态经后端推导（at_risk/missed），
 * 表单编辑的是持久化人工态（`storedStatus`），避免把推导态误当人工设定。
 */
export function MilestoneManager({ projectId }: MilestoneManagerProps) {
  const { can } = usePermissions()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)

  const canView = can('milestone:view')
  const canCreate = can('milestone:create')
  const canUpdate = can('milestone:update')
  const canDelete = can('milestone:delete')

  if (!canView) return null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setEditing(null)
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Flag className="h-4 w-4" />
          里程碑
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col p-0">
        <SheetHeader>
          <SheetTitle>里程碑管理</SheetTitle>
          <SheetDescription>
            管理项目里程碑；有风险 / 已逾期由系统按目标日期自动提示，达成需人工确认。
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto p-6">
          {editing ? (
            <MilestoneForm
              projectId={projectId}
              editing={editing}
              onDone={() => setEditing(null)}
            />
          ) : (
            <MilestoneList
              projectId={projectId}
              canCreate={canCreate}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onCreate={() => setEditing({ mode: 'create' })}
              onEdit={(milestone) => setEditing({ mode: 'edit', milestone })}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MilestoneList({
  projectId,
  canCreate,
  canUpdate,
  canDelete,
  onCreate,
  onEdit,
}: {
  projectId: number
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  onCreate: () => void
  onEdit: (milestone: Milestone) => void
}) {
  const { data, isLoading, isError, refetch } = useMilestones(projectId)
  const deleteMilestone = useDeleteMilestone(projectId)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

  const milestones = data?.data ?? []

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <EmptyState
        icon={Flag}
        title="里程碑加载失败"
        description="拉取里程碑时出错，请稍后重试。"
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            重试
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {canCreate ? (
        <Button variant="primary" size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          新建里程碑
        </Button>
      ) : (
        <p className="text-xs text-muted">当前角色为只读，仅可查看里程碑。</p>
      )}

      {milestones.length === 0 ? (
        <EmptyState
          icon={Flag}
          title="暂无里程碑"
          description={
            canCreate
              ? '为项目添加里程碑后，甘特图会按状态着色的菱形标记它们。'
              : '项目暂未设置里程碑。'
          }
        />
      ) : (
        <ul className="space-y-2">
          {milestones.map((milestone) => {
            const meta = STATUS_META[milestone.status]
            const confirming = confirmingId === milestone.id
            return (
              <li
                key={milestone.id}
                className="rounded-[var(--radius-md)] border border-border bg-gray-0 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-800">{milestone.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span>{milestone.plannedDate ?? '未设目标日期'}</span>
                    </div>
                  </div>
                  {(canUpdate || canDelete) && !confirming ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {canUpdate ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="编辑里程碑"
                          onClick={() => onEdit(milestone)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="删除里程碑"
                          onClick={() => setConfirmingId(milestone.id)}
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {confirming ? (
                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3 text-sm">
                    <span className="mr-auto text-muted">确认删除「{milestone.name}」？</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={deleteMilestone.isPending}
                      onClick={() => setConfirmingId(null)}
                    >
                      取消
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deleteMilestone.isPending}
                      onClick={() =>
                        deleteMilestone.mutate(milestone.id, {
                          onSuccess: () => setConfirmingId(null),
                        })
                      }
                    >
                      删除
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function MilestoneForm({
  projectId,
  editing,
  onDone,
}: {
  projectId: number
  editing: Exclude<Editing, null>
  onDone: () => void
}) {
  const createMilestone = useCreateMilestone(projectId)
  const updateMilestone = useUpdateMilestone(projectId)
  const isEdit = editing.mode === 'edit'

  const form = useForm<MilestoneFormValues>({
    resolver: zodResolver(milestoneFormSchema),
    defaultValues: isEdit
      ? {
          name: editing.milestone.name,
          description: editing.milestone.description ?? '',
          // 回填持久化人工态，而非推导展示态。
          status: editing.milestone.storedStatus,
          plannedDate: editing.milestone.plannedDate ?? '',
        }
      : { name: '', description: '', status: 'not_started', plannedDate: '' },
  })

  const statusOptions = useMemo<MilestoneStatus[]>(() => {
    // 若当前持久化态是系统专属态（at_risk/missed，历史遗留），保留在选项中避免丢值。
    const base = [...HUMAN_STATUS_OPTIONS]
    if (isEdit && !base.includes(editing.milestone.storedStatus)) {
      base.push(editing.milestone.storedStatus)
    }
    return base
  }, [editing, isEdit])

  async function onSubmit(values: MilestoneFormValues) {
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() ? values.description.trim() : null,
      status: values.status,
      plannedDate: values.plannedDate ? values.plannedDate : null,
    }
    try {
      if (isEdit) {
        await updateMilestone.mutateAsync({ milestoneId: editing.milestone.id, input: payload })
      } else {
        await createMilestone.mutateAsync(payload)
      }
      onDone()
    } catch {
      // mutation hook 已以中文 Toast 反馈；保留表单内容供用户修正或重试。
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>名称</FormLabel>
              <FormControl>
                <Input placeholder="如：需求冻结" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="plannedDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>目标日期</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>状态</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择状态" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_META[status].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>描述（可选）</FormLabel>
              <FormControl>
                <Textarea rows={3} placeholder="里程碑说明" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onDone}>
            取消
          </Button>
          <FormSubmit>
            {form.watch('status') === 'achieved' ? '确认达成' : isEdit ? '保存' : '创建'}
          </FormSubmit>
        </div>
      </form>
    </Form>
  )
}

export default MilestoneManager
