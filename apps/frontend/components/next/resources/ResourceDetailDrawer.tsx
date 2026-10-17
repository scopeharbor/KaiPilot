'use client'

/**
 * 资源详情抽屉（新轨资源工作台补齐件）。
 *
 * 对齐旧轨 /projects/:id/resources/:resourceId 详情页（4 标签页）的三件缺口：
 * - 「基本信息」：查看 + 编辑（resource:manage 才可编辑保存，只读用户纯查看）；
 * - 「可用性」：例外清单 + 添加（日期区间/容量覆写/原因）+ 删除（resource:manage 或本人资源）；
 * - 「负载」：单资源 14 天负载热力格 + 综合利用率（resourcesApi.load view=team）。
 *
 * 抽屉范式沿用新轨（固定右侧滑出、useDialogA11y 焦点/Escape、--nx-* 令牌）。
 */

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'
import {
  availabilityApi,
  availabilityKeys,
  resourceKeys,
  resourcesApi,
  type DateAllocationSummary,
  type Resource,
  type ResourceAvailabilityException,
  type UpdateResourceInput,
} from '@/lib/api/resources'
import { invalidateResourceQueries } from '@/lib/resource-query-invalidation'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { cn } from '@/lib/utils'

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  human: '人员',
  material: '物料',
  equipment: '设备',
  budget: '预算',
}

const inputClass =
  'h-7 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-xs text-[var(--nx-text-primary)] outline-none focus:border-[var(--nx-border-focus)] disabled:opacity-50'

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

type DetailTab = 'info' | 'availability' | 'load'

export interface ResourceDetailDrawerProps {
  projectId: number
  /** 打开的资源 id；null = 关闭。 */
  resourceId: number | null
  onClose: () => void
  /** resource:manage 写权限。 */
  canManage: boolean
  /** 当前用户 id（可用性本人可编辑判定用）。 */
  currentUserId: number | null
}

export function ResourceDetailDrawer({
  projectId,
  resourceId,
  onClose,
  canManage,
  currentUserId,
}: ResourceDetailDrawerProps) {
  const [tab, setTab] = React.useState<DetailTab>('info')
  const panelRef = React.useRef<HTMLDivElement>(null)
  const open = resourceId !== null

  useDialogA11y({ ref: panelRef, open, onClose })

  React.useEffect(() => {
    if (open) setTab('info')
  }, [open, resourceId])

  const detailQuery = useQuery({
    queryKey: resourceKeys.detail(projectId, resourceId ?? 0),
    queryFn: () => resourcesApi.get(projectId, resourceId ?? 0),
    enabled: open,
  })
  // apiFetch 对 detail 端点自动拆信封：运行时返回体即 Resource；api 层类型标注仍声明
  // {data: Resource & {allocations}} 信封（旧轨 /resources/[resourceId] 的 res?.data 亦依赖
  // 该标注）。此处按运行时事实收窄（RL-14 如实呈现，不臆造信封）。
  const resource = (detailQuery.data as unknown as Resource | undefined) ?? null

  const availabilityQuery = useQuery({
    queryKey: availabilityKeys.list(projectId, resourceId ?? 0),
    queryFn: () => availabilityApi.list(projectId, resourceId ?? 0, { perPage: 50 }),
    enabled: open && tab === 'availability',
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40" data-resource-detail-drawer-root>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`资源详情 ${resource?.name ?? ''}`}
        tabIndex={-1}
        data-resource-detail-drawer
        className="absolute bottom-0 right-0 top-0 flex w-[520px] max-w-full flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] outline-none"
      >
        <header className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
              {resource?.name ?? '资源详情'}
            </h2>
            {resource ? (
              <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                {RESOURCE_TYPE_LABELS[resource.resourceType] ?? resource.resourceType} ·{' '}
                {resource.role ?? '—'} · {resource.status === 'active' ? '活跃' : '停用'}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="关闭资源详情"
            data-resource-detail-close
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div
          role="tablist"
          aria-label="资源详情视图"
          className="flex items-center gap-1 border-b border-[var(--nx-border-hairline)] px-4 py-1.5"
        >
          {(
            [
              { id: 'info', label: '基本信息' },
              { id: 'availability', label: '可用性' },
              { id: 'load', label: '负载' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              data-resource-detail-tab={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                'h-6 rounded-sm px-2.5 text-[11px] transition-colors',
                tab === item.id
                  ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                  : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {detailQuery.isPending ? (
            <div data-resource-detail-loading className="flex flex-col gap-2" aria-busy="true">
              {[0, 1, 2].map((k) => (
                <div
                  key={k}
                  className="h-10 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
                />
              ))}
            </div>
          ) : !resource ? (
            <div
              data-resource-detail-error
              className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3 text-xs text-[var(--nx-status-danger)]"
            >
              资源不存在或加载失败
            </div>
          ) : tab === 'info' ? (
            <InfoTab projectId={projectId} resource={resource} canManage={canManage} />
          ) : tab === 'availability' ? (
            <AvailabilityTab
              projectId={projectId}
              resourceId={resource.id}
              exceptions={availabilityQuery.data?.data ?? []}
              loading={availabilityQuery.isPending}
              canEdit={canManage || (resource.userId !== null && resource.userId === currentUserId)}
            />
          ) : (
            <LoadTab projectId={projectId} resourceId={resource.id} />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 基本信息（查看 + 编辑）
// ---------------------------------------------------------------------------

function InfoTab({
  projectId,
  resource,
  canManage,
}: {
  projectId: number
  resource: Resource
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = React.useState(false)
  const [form, setForm] = React.useState({
    name: resource.name,
    email: resource.email ?? '',
    dailyCapacityHours: String(resource.dailyCapacityHours ?? 8),
    timezone: resource.timezone ?? 'Asia/Shanghai',
    skillTags: Array.isArray(resource.skillTags) ? resource.skillTags.join(', ') : '',
  })

  const update = useMutation({
    mutationFn: (input: UpdateResourceInput) => resourcesApi.update(projectId, resource.id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceKeys.detail(projectId, resource.id) })
      void queryClient.invalidateQueries({ queryKey: resourceKeys.lists(projectId) })
      setEditing(false)
    },
  })

  return (
    <div className="flex flex-col gap-3" data-resource-info-tab>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[var(--nx-text-muted)]">邮箱</p>
          <p className="mt-0.5 text-[var(--nx-text-primary)]">{resource.email ?? '—'}</p>
        </div>
        <div>
          <p className="text-[var(--nx-text-muted)]">日产能</p>
          <p className="mt-0.5 text-[var(--nx-text-primary)]">{resource.dailyCapacityHours} 小时</p>
        </div>
        <div>
          <p className="text-[var(--nx-text-muted)]">时区</p>
          <p className="mt-0.5 text-[var(--nx-text-primary)]">{resource.timezone}</p>
        </div>
        <div>
          <p className="text-[var(--nx-text-muted)]">工作日</p>
          <p className="mt-0.5 text-[var(--nx-text-primary)]">
            {Array.isArray(resource.workDays) ? resource.workDays.join('、') : '—'}
          </p>
        </div>
        {resource.skillTags ? (
          <div className="col-span-2">
            <p className="text-[var(--nx-text-muted)]">技能标签</p>
            <p className="mt-0.5 text-[var(--nx-text-primary)]">
              {Array.isArray(resource.skillTags)
                ? resource.skillTags.join('、')
                : String(resource.skillTags)}
            </p>
          </div>
        ) : null}
      </div>

      {canManage ? (
        editing ? (
          <form
            data-resource-info-form
            className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
            onSubmit={(event) => {
              event.preventDefault()
              update.mutate({
                name: form.name.trim(),
                email: form.email.trim() || null,
                dailyCapacityHours: Number(form.dailyCapacityHours),
                timezone: form.timezone.trim() || 'Asia/Shanghai',
                skillTags: form.skillTags
                  .split(/[,，]/)
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }}
          >
            <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
              名称
              <input
                aria-label="资源名称"
                className={inputClass}
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
                邮箱
                <input
                  aria-label="资源邮箱"
                  className={inputClass}
                  value={form.email}
                  onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
                日产能（小时）
                <input
                  aria-label="日产能"
                  type="number"
                  min={0}
                  max={24}
                  className={inputClass}
                  value={form.dailyCapacityHours}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, dailyCapacityHours: event.target.value }))
                  }
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
              技能标签（逗号分隔）
              <input
                aria-label="技能标签"
                className={inputClass}
                value={form.skillTags}
                onChange={(event) => setForm((f) => ({ ...f, skillTags: event.target.value }))}
              />
            </label>
            {update.isError ? (
              <p data-resource-info-error className="text-[11px] text-[var(--nx-status-danger)]">
                {errorText(update.error)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-7 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-0)]"
              >
                取消
              </button>
              <button
                type="submit"
                data-resource-info-save
                disabled={!form.name.trim() || update.isPending}
                className="h-7 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] disabled:opacity-50"
              >
                {update.isPending ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            data-resource-info-edit
            onClick={() => setEditing(true)}
            className="h-7 w-fit rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            编辑基本信息
          </button>
        )
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 可用性例外管理
// ---------------------------------------------------------------------------

function AvailabilityTab({
  projectId,
  resourceId,
  exceptions,
  loading,
  canEdit,
}: {
  projectId: number
  resourceId: number
  exceptions: readonly ResourceAvailabilityException[]
  loading: boolean
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [showForm, setShowForm] = React.useState(false)
  const [startDate, setStartDate] = React.useState(today)
  const [endDate, setEndDate] = React.useState(today)
  const [capacityOverrideHours, setCapacityOverrideHours] = React.useState('0')
  const [reason, setReason] = React.useState('')

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: availabilityKeys.list(projectId, resourceId) }),
      invalidateResourceQueries(queryClient, projectId),
    ])
  }

  const create = useMutation({
    mutationFn: () =>
      availabilityApi.create(projectId, resourceId, {
        startDate,
        endDate,
        capacityOverrideHours: Number(capacityOverrideHours),
        reason,
        status: 'planned',
      }),
    onSuccess: async () => {
      await invalidate()
      setShowForm(false)
      setCapacityOverrideHours('0')
      setReason('')
    },
  })

  const del = useMutation({
    mutationFn: (id: number) => availabilityApi.delete(projectId, resourceId, id),
    onSuccess: invalidate,
  })

  return (
    <div className="flex flex-col gap-3" data-resource-availability-tab>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-[var(--nx-text-primary)]">可用性例外</h3>
        {canEdit ? (
          <button
            type="button"
            data-resource-availability-create-open
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <Plus className="h-3 w-3" aria-hidden />
            添加例外
          </button>
        ) : null}
      </div>

      {showForm ? (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
              开始日期
              <input
                aria-label="例外开始日期"
                type="date"
                className={inputClass}
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
              结束日期
              <input
                aria-label="例外结束日期"
                type="date"
                className={inputClass}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
              容量覆写（小时）
              <input
                aria-label="容量覆写"
                type="number"
                min={0}
                max={24}
                className={inputClass}
                value={capacityOverrideHours}
                onChange={(event) => setCapacityOverrideHours(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
              原因
              <input
                aria-label="例外原因"
                className={inputClass}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          {create.isError ? (
            <p
              data-resource-availability-error
              className="text-[11px] text-[var(--nx-status-danger)]"
            >
              {errorText(create.error)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-7 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)]"
            >
              取消
            </button>
            <button
              type="button"
              data-resource-availability-save
              disabled={!reason.trim() || create.isPending}
              onClick={() => create.mutate()}
              className="h-7 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] disabled:opacity-50"
            >
              {create.isPending ? '保存中…' : '保存例外'}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div data-resource-availability-loading className="flex flex-col gap-2" aria-busy="true">
          {[0, 1].map((k) => (
            <div
              key={k}
              className="h-9 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            />
          ))}
        </div>
      ) : exceptions.length === 0 ? (
        <p
          data-resource-availability-empty
          className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-4 py-6 text-center text-[11px] text-[var(--nx-text-muted)]"
        >
          暂无可用性例外
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-resource-availability-list>
          {exceptions.map((exception) => (
            <li
              key={exception.id}
              data-resource-availability-row={exception.id}
              className="flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-[11px]"
            >
              <span className="font-mono text-[var(--nx-text-secondary)]">
                {exception.startDate} ~ {exception.endDate}
              </span>
              <span className="text-[var(--nx-text-primary)]">
                {exception.capacityOverrideHours}h
              </span>
              <span className="flex-1 truncate text-[var(--nx-text-muted)]">
                {exception.reason}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`删除例外 ${exception.id}`}
                  data-resource-availability-delete={exception.id}
                  disabled={del.isPending}
                  onClick={() => del.mutate(exception.id)}
                  className="rounded-md p-1 text-[var(--nx-text-muted)] hover:text-[var(--nx-status-danger)] disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单资源负载
// ---------------------------------------------------------------------------

function LoadTab({ projectId, resourceId }: { projectId: number; resourceId: number }) {
  const today = new Date().toISOString().slice(0, 10)
  const weekLater = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  const { data, isPending } = useQuery({
    queryKey: resourceKeys.load(projectId, {
      from: today,
      to: weekLater,
      view: 'team',
      resourceId,
    }),
    queryFn: () =>
      resourcesApi.load(projectId, { from: today, to: weekLater, view: 'team', resourceId }),
  })

  if (isPending) {
    return (
      <div
        data-resource-load-loading
        aria-busy="true"
        className="h-28 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
      />
    )
  }

  const loadResult =
    data && 'resources' in data
      ? (
          data as {
            resources: { days: DateAllocationSummary[]; overallUtilizationPercent: number }[]
          }
        ).resources[0]
      : null

  if (!loadResult) {
    return (
      <p
        data-resource-load-empty
        className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-4 py-6 text-center text-[11px] text-[var(--nx-text-muted)]"
      >
        暂无负载数据
      </p>
    )
  }

  const percent = loadResult.overallUtilizationPercent

  return (
    <div className="flex flex-col gap-3" data-resource-load-tab>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[var(--nx-text-muted)]">
          综合利用率（{today} ~ {weekLater}）
        </span>
        <span
          data-resource-load-percent
          className={cn(
            'font-mono text-sm font-semibold',
            percent > 100
              ? 'text-[var(--nx-status-danger)]'
              : percent > 80
                ? 'text-[var(--nx-status-warning)]'
                : 'text-[var(--nx-status-success)]',
          )}
        >
          {percent}%
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1" data-resource-load-grid>
        {loadResult.days.map((day) => {
          const pct = day.totalAllocatedPercent
          return (
            <div key={day.date} className="flex flex-col items-center gap-1">
              <div
                data-resource-load-day={day.date}
                title={`${day.date}: ${pct}%`}
                className={cn(
                  'h-8 w-full rounded-sm',
                  pct > 100
                    ? 'bg-[var(--nx-status-danger)]'
                    : pct > 80
                      ? 'bg-[var(--nx-status-warning)]'
                      : pct > 0
                        ? 'bg-[var(--nx-status-success)]'
                        : 'bg-[var(--nx-bg-0)]',
                )}
              />
              <span className="text-[9px] text-[var(--nx-text-muted)]">{day.date.slice(5)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ResourceDetailDrawer
