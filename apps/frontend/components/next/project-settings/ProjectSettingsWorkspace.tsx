'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { CalendarDays, Info, Plus, RotateCcw, Save, ShieldAlert, Trash2 } from 'lucide-react'
import {
  DEFAULT_WORKING_CALENDAR_SETTINGS,
  normalizeWorkingCalendarSettings,
  type WorkingCalendarSettings,
} from '@aiproj/types'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { useUpdateWorkingCalendar, useWorkingCalendar } from '@/hooks/use-working-calendar'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { DomainPageHeader } from '@/components/next/common/DomainPageHeader'
import {
  isNotFoundError,
  ProjectSpaceErrorView,
  ProjectSpaceNotFoundView,
  ProjectSpaceSkeleton,
} from '@/components/next/project-space/ProjectSpaceContainer'

/**
 * 项目设置域主工作区（v3-ui-next-settings-admin-domains W8 · tasks 8.1，
 * design D-PROJ / spec「项目设置（工作日历）」）。
 *
 * - 项目详情经 projectsApi.get 载入（与主工作面同键 projectKeys.detail，RL-04）；
 * - RL-05 组织隔离：跨组织 / HTTP 404 统一中性空态「项目不存在或已被移除」，
 *   项目归属校验通过前工作日历端点零请求（RL-06 防探测）；
 * - 工作日历编辑器等价迁移旧轨 `GET/PATCH /projects/:id/working-calendar`
 *   （`useWorkingCalendar` / `useUpdateWorkingCalendar`，`@aiproj/types` 归一化）；
 *   前端即时校验：至少一个周工作日、同一日期不得重复或同时为节假日与调休日
 *   （非法输入直接阻断，零请求）；脏检查驱动保存/取消按钮；
 * - 编辑门禁 `project:update` + 归档只读锁（只读态渲染横幅并禁用一切编辑控件）；
 * - 保存失败保留草稿并回显服务端 `ApiError.message`（禁止静默）；
 * - 三态闭环：骨架屏（aria-busy）/ 语义化空态 / 错误重试卡；精确档（precise）
 *   停用空间光晕，面板一律 1px 发丝线纯色呈现。
 */

const WEEKDAYS = [
  { value: 0, label: '周日' },
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
] as const

/** 保存前警示文案（spec「保存前提示任务起止日期不会自动改写」）。 */
const SAVE_WARNING = '保存后相关视图会刷新，但任务起止日期不会自动改写。'

const ERROR_DATE_DUPLICATE = '日期不能重复。'
const ERROR_DATE_CONFLICT = '同一日期不能同时作为节假日和调休日。'
const ERROR_NO_WORKDAY = '至少选择一个每周工作日。'

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function serializeCalendar(calendar: WorkingCalendarSettings): string {
  return JSON.stringify({
    workdays: [...calendar.workdays].sort((left, right) => left - right),
    holidays: sortedUnique(calendar.holidays),
    extraWorkdays: sortedUnique(calendar.extraWorkdays),
  })
}

function apiErrorMessage(error: unknown): string | null {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return null
}

export interface ProjectSettingsWorkspaceProps {
  projectId: number
}

export function ProjectSettingsWorkspace({ projectId }: ProjectSettingsWorkspaceProps) {
  const router = useRouter()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const tier = useImmersionTier()

  const {
    data: project,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  })

  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const notFound = orgMismatch || (isError && isNotFoundError(error))

  if (isPending) {
    return <ProjectSpaceSkeleton />
  }
  if (notFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (isError || project === undefined) {
    return (
      <ProjectSpaceErrorView
        onRetry={() => void refetch()}
        onBackHome={() => router.push('/next')}
      />
    )
  }

  return (
    <div
      data-project-settings-workspace
      data-immersion={tier}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <DomainPageHeader
        projectId={projectId}
        projectName={project.name}
        domainLabel="项目设置"
        description={`#${project.code ?? `PROJ-${project.id}`} · 工作日历影响甘特排程与关键路径计算`}
      />

      <WorkingCalendarEditor projectId={projectId} archived={project.status === 'archived'} />
      <a
        data-project-calendar-display-link
        href={`/next/settings/calendar?projectId=${projectId}`}
        className="w-fit text-xs text-[var(--nx-accent)] underline-offset-2 hover:underline"
      >
        日历显示哪些曆法（公历 / 农历 / 藏历 / 回历、节气、假日…）→ 日历与曆法设定
      </a>
    </div>
  )
}

interface WorkingCalendarEditorProps {
  projectId: number
  /** 项目已归档：只读锁（服务端 `assertNotArchived` 语义镜像）。 */
  archived: boolean
}

function WorkingCalendarEditor({ projectId, archived }: WorkingCalendarEditorProps) {
  const { can } = usePermissions()
  const calendarQuery = useWorkingCalendar(projectId)
  const updateCalendar = useUpdateWorkingCalendar(projectId)

  const canUpdate = can('project:update')
  const readOnly = !canUpdate || archived

  const [draft, setDraft] = React.useState<WorkingCalendarSettings>(
    DEFAULT_WORKING_CALENDAR_SETTINGS,
  )
  const [holidayInput, setHolidayInput] = React.useState('')
  const [extraWorkdayInput, setExtraWorkdayInput] = React.useState('')
  const [clientError, setClientError] = React.useState<string | null>(null)

  const rawCalendar = calendarQuery.data
  const saved = React.useMemo<WorkingCalendarSettings | undefined>(() => {
    if (rawCalendar === undefined) return undefined
    try {
      const unwrapped =
        typeof rawCalendar === 'object' &&
        rawCalendar !== null &&
        'data' in rawCalendar &&
        (rawCalendar as { data?: unknown }).data
          ? (rawCalendar as { data: unknown }).data
          : rawCalendar
      return normalizeWorkingCalendarSettings(unwrapped as Partial<WorkingCalendarSettings>)
    } catch {
      return (
        (rawCalendar as unknown as WorkingCalendarSettings) ?? DEFAULT_WORKING_CALENDAR_SETTINGS
      )
    }
  }, [rawCalendar])

  React.useEffect(() => {
    if (saved !== undefined) {
      setDraft(saved)
      setClientError(null)
    }
  }, [saved])

  const isDirty = React.useMemo(
    () => saved !== undefined && serializeCalendar(draft) !== serializeCalendar(saved),
    [draft, saved],
  )
  const workdaysValid = draft.workdays.length > 0
  const serverError = apiErrorMessage(updateCalendar.error)
  const error = clientError ?? serverError

  function setWorkday(day: number, checked: boolean) {
    const nextWorkdays = checked
      ? [...new Set([...draft.workdays, day])].sort((left, right) => left - right)
      : draft.workdays.filter((value) => value !== day)
    setClientError(nextWorkdays.length === 0 ? ERROR_NO_WORKDAY : null)
    setDraft((current) => ({ ...current, workdays: nextWorkdays }))
  }

  function addDate(field: 'holidays' | 'extraWorkdays', value: string) {
    if (!value) return
    const otherField = field === 'holidays' ? 'extraWorkdays' : 'holidays'
    if (draft[field].includes(value)) {
      setClientError(ERROR_DATE_DUPLICATE)
      return
    }
    if (draft[otherField].includes(value)) {
      setClientError(ERROR_DATE_CONFLICT)
      return
    }
    setClientError(null)
    setDraft((current) => ({ ...current, [field]: sortedUnique([...current[field], value]) }))
    if (field === 'holidays') setHolidayInput('')
    if (field === 'extraWorkdays') setExtraWorkdayInput('')
  }

  function removeDate(field: 'holidays' | 'extraWorkdays', value: string) {
    setClientError(null)
    setDraft((current) => ({
      ...current,
      [field]: current[field].filter((date) => date !== value),
    }))
  }

  function resetDraft() {
    if (saved === undefined) return
    setDraft(saved)
    setHolidayInput('')
    setExtraWorkdayInput('')
    setClientError(null)
  }

  async function save() {
    if (!workdaysValid) {
      setClientError(ERROR_NO_WORKDAY)
      return
    }
    setClientError(null)
    // 提交体严格限定为 @aiproj/types 契约的四个字段（服务端拒绝范围外字段）。
    const payload = normalizeWorkingCalendarSettings({
      version: draft.version,
      workdays: draft.workdays,
      holidays: draft.holidays,
      extraWorkdays: draft.extraWorkdays,
    })
    try {
      await updateCalendar.mutateAsync(payload)
    } catch {
      // 失败保留草稿；服务端错误经 mutation.error 呈现，不静默吞掉。
    }
  }

  if (calendarQuery.isPending) {
    return (
      <div
        data-calendar-skeleton
        role="status"
        aria-busy="true"
        aria-label="正在加载工作日历"
        className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <div className="h-6 w-32 animate-pulse rounded bg-[var(--nx-bg-1)]" />
        <div className="h-24 animate-pulse rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]" />
        <div className="h-16 animate-pulse rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]" />
      </div>
    )
  }

  if (calendarQuery.isError || saved === undefined) {
    return (
      <div
        data-calendar-load-error
        role="alert"
        className="flex flex-col items-start gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6"
      >
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--nx-text-primary)]">
          <ShieldAlert className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
          工作日历加载失败
        </h3>
        <p className="text-xs text-[var(--nx-text-muted)]">
          {apiErrorMessage(calendarQuery.error) ?? '工作日历数据加载失败，请稍后重试。'}
        </p>
        <button
          type="button"
          data-calendar-load-retry
          onClick={() => void calendarQuery.refetch()}
          className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)]"
        >
          重新载入
        </button>
      </div>
    )
  }

  return (
    <section data-calendar-editor className="flex flex-col gap-3">
      {readOnly ? (
        <div
          data-project-settings-readonly
          role="status"
          className="flex items-start gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-status-warning)]" aria-hidden />
          <div>
            <p className="text-xs font-medium text-[var(--nx-text-primary)]">只读模式</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              {archived
                ? '项目已归档，需先恢复才能修改工作日历。'
                : '当前账号没有项目更新权限，只能查看工作日历。'}
            </p>
          </div>
        </div>
      ) : null}

      {isDirty ? (
        <div
          data-project-settings-dirty
          role="status"
          className="flex items-start gap-2 rounded-md border border-[var(--nx-status-warning)] bg-[var(--nx-bg-1)] px-4 py-3"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-status-warning)]" aria-hidden />
          <div>
            <p className="text-xs font-medium text-[var(--nx-text-primary)]">
              有未保存的工作日历变更
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              {SAVE_WARNING}
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          data-project-settings-error
          role="alert"
          className="flex items-start gap-2 rounded-md border border-[var(--nx-status-danger)] bg-[var(--nx-bg-1)] px-4 py-3"
        >
          <ShieldAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-status-danger)]"
            aria-hidden
          />
          <div>
            <p className="text-xs font-medium text-[var(--nx-text-primary)]">工作日历未保存</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              {error}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3">
        <p className="flex items-center gap-2 text-[11px] text-[var(--nx-text-secondary)]">
          <CalendarDays className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
          使用 0 表示周日；节假日优先于常规工作日，调休日即使落在周末也按工作日处理。
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-calendar-cancel
            disabled={!isDirty || updateCalendar.isPending}
            onClick={resetDraft}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            取消
          </button>
          <button
            type="button"
            data-calendar-save
            disabled={!isDirty || readOnly || !workdaysValid || updateCalendar.isPending}
            onClick={() => void save()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {updateCalendar.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4">
        <section className="flex flex-col gap-3" aria-labelledby="project-workdays-title">
          <div>
            <h3
              id="project-workdays-title"
              className="text-sm font-medium text-[var(--nx-text-primary)]"
            >
              每周工作日
            </h3>
            <p className="text-[11px] text-[var(--nx-text-muted)]">
              至少保留一个工作日；清空全部工作日将阻断保存。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {WEEKDAYS.map((day) => {
              const checked = draft.workdays.includes(day.value)
              return (
                <label
                  key={day.value}
                  data-calendar-weekday={day.value}
                  className={cn(
                    'flex min-h-10 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs',
                    readOnly
                      ? 'bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)]'
                      : 'bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)]',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={(event) => setWorkday(day.value, event.target.checked)}
                    aria-label={`${day.label}是否为工作日`}
                    className="h-3.5 w-3.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] accent-[var(--nx-workspace-blue)]"
                  />
                  {day.label}
                </label>
              )
            })}
          </div>
        </section>

        <DateListEditor
          title="节假日"
          field="holidays"
          description="这些日期即使落在常规工作日，也按非工作日处理。"
          values={draft.holidays}
          inputValue={holidayInput}
          readOnly={readOnly}
          onInputChange={setHolidayInput}
          onAdd={() => addDate('holidays', holidayInput)}
          onRemove={(value) => removeDate('holidays', value)}
        />

        <DateListEditor
          title="调休日"
          field="extraWorkdays"
          description="这些日期即使落在周末，也按工作日处理。"
          values={draft.extraWorkdays}
          inputValue={extraWorkdayInput}
          readOnly={readOnly}
          onInputChange={setExtraWorkdayInput}
          onAdd={() => addDate('extraWorkdays', extraWorkdayInput)}
          onRemove={(value) => removeDate('extraWorkdays', value)}
        />
      </div>
    </section>
  )
}

interface DateListEditorProps {
  title: string
  field: 'holidays' | 'extraWorkdays'
  description: string
  values: readonly string[]
  inputValue: string
  readOnly: boolean
  onInputChange: (value: string) => void
  onAdd: () => void
  onRemove: (value: string) => void
}

function DateListEditor({
  title,
  field,
  description,
  values,
  inputValue,
  readOnly,
  onInputChange,
  onAdd,
  onRemove,
}: DateListEditorProps) {
  const emptyLabel = field === 'holidays' ? '暂无节假日' : '暂无调休日'

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`project-${field}-title`}>
      <div>
        <h3
          id={`project-${field}-title`}
          className="text-sm font-medium text-[var(--nx-text-primary)]"
        >
          {title}
        </h3>
        <p className="text-[11px] text-[var(--nx-text-muted)]">{description}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="date"
          data-calendar-date-input={field}
          value={inputValue}
          disabled={readOnly}
          onChange={(event) => onInputChange(event.target.value)}
          aria-label={`添加${title}日期`}
          className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-48"
        />
        <button
          type="button"
          data-calendar-add-date={field}
          onClick={onAdd}
          disabled={readOnly || inputValue === ''}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          添加
        </button>
      </div>
      <div data-calendar-date-list={field} className="flex flex-wrap gap-2">
        {values.length === 0 ? (
          <p data-calendar-date-empty={field} className="text-[11px] text-[var(--nx-text-muted)]">
            {emptyLabel}
          </p>
        ) : null}
        {values.map((value) => (
          <span
            key={value}
            data-calendar-date-chip={`${field}:${value}`}
            className="inline-flex min-h-8 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)]"
          >
            <span className="font-mono">{value}</span>
            <button
              type="button"
              data-calendar-remove-date={`${field}:${value}`}
              onClick={() => onRemove(value)}
              disabled={readOnly}
              aria-label={`删除${title}${value}`}
              className="rounded p-0.5 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-status-danger)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ))}
      </div>
    </section>
  )
}

export default ProjectSettingsWorkspace
