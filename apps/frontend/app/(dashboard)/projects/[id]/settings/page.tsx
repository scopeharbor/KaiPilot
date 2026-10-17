'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import {
  DEFAULT_WORKING_CALENDAR_SETTINGS,
  normalizeWorkingCalendarSettings,
  type WorkingCalendarSettings,
} from '@aiproj/types'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePermissions } from '@/hooks/use-permissions'
import { useUpdateWorkingCalendar, useWorkingCalendar } from '@/hooks/use-working-calendar'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import type { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'

const WEEKDAYS = [
  { value: 0, label: '周日' },
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
] as const

export default function ProjectSettingsPage() {
  const params = useParams()
  const projectId = Number(params?.id)
  const { can } = usePermissions()
  const projectQuery = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
  const calendarQuery = useWorkingCalendar(projectId)
  const updateCalendar = useUpdateWorkingCalendar(projectId)
  const [draft, setDraft] = useState<WorkingCalendarSettings>(DEFAULT_WORKING_CALENDAR_SETTINGS)
  const [holidayInput, setHolidayInput] = useState('')
  const [extraWorkdayInput, setExtraWorkdayInput] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)

  useEffect(() => {
    if (calendarQuery.data) {
      setDraft(calendarQuery.data)
      setClientError(null)
    }
  }, [calendarQuery.data])

  const isReadOnly = !can('project:update') || projectQuery.data?.status === 'archived'
  const saved = calendarQuery.data ?? DEFAULT_WORKING_CALENDAR_SETTINGS
  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])
  const error = clientError ?? (updateCalendar.error as ApiError | null)?.message ?? null

  function setWorkday(day: number, checked: boolean) {
    setDraft((current) =>
      normalizeWorkingCalendarSettings({
        ...current,
        workdays: checked
          ? [...current.workdays, day]
          : current.workdays.filter((value) => value !== day),
      }),
    )
  }

  function addDate(field: 'holidays' | 'extraWorkdays', value: string) {
    setClientError(null)
    if (!value) return
    const otherField = field === 'holidays' ? 'extraWorkdays' : 'holidays'
    if (draft[field].includes(value)) {
      setClientError('日期不能重复。')
      return
    }
    if (draft[otherField].includes(value)) {
      setClientError('同一日期不能同时作为节假日和调休日。')
      return
    }
    setDraft((current) =>
      normalizeWorkingCalendarSettings({ ...current, [field]: [...current[field], value] }),
    )
    if (field === 'holidays') setHolidayInput('')
    if (field === 'extraWorkdays') setExtraWorkdayInput('')
  }

  function removeDate(field: 'holidays' | 'extraWorkdays', value: string) {
    setDraft((current) =>
      normalizeWorkingCalendarSettings({
        ...current,
        [field]: current[field].filter((date) => date !== value),
      }),
    )
  }

  async function save() {
    setClientError(null)
    if (draft.workdays.length === 0) {
      setClientError('至少选择一个每周工作日。')
      return
    }
    try {
      await updateCalendar.mutateAsync(normalizeWorkingCalendarSettings(draft))
    } catch {
      // Mutation state renders the API error and keeps the unsaved draft.
    }
  }

  if (calendarQuery.isLoading || projectQuery.isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-80 w-full" />
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">项目设置</h1>
          <p className="text-sm text-gray-500">工作日历会影响甘特排程和关键路径计算。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDraft(saved)}
            disabled={!isDirty || updateCalendar.isPending}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            取消
          </Button>
          <Button
            type="button"
            onClick={save}
            loading={updateCalendar.isPending}
            disabled={!isDirty || isReadOnly}
          >
            <Save className="h-4 w-4" aria-hidden />
            保存
          </Button>
        </div>
      </div>

      {isReadOnly ? (
        <Alert variant="info" title="只读模式">
          {projectQuery.data?.status === 'archived'
            ? '项目已归档，需先恢复才能修改工作日历。'
            : '当前账号没有项目更新权限，只能查看工作日历。'}
        </Alert>
      ) : null}
      {isDirty ? (
        <Alert variant="warning" title="有未保存的工作日历变更">
          保存后相关视图会刷新，但任务起止日期不会自动改写。
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="danger" title="工作日历未保存">
          {error}
        </Alert>
      ) : null}

      <Card variant="outlined">
        <CardHeader>
          <CardTitle>工作日历</CardTitle>
          <CardDescription>使用 0 表示周日，节假日优先于常规工作日。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-3" aria-labelledby="workdays-title">
            <h2 id="workdays-title" className="text-sm font-medium text-gray-800">
              每周工作日
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {WEEKDAYS.map((day) => (
                <label
                  key={day.value}
                  className={cn(
                    'flex min-h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-border px-3 text-sm',
                    isReadOnly ? 'bg-gray-50 text-gray-500' : 'bg-gray-0 text-gray-700',
                  )}
                >
                  <Checkbox
                    checked={draft.workdays.includes(day.value)}
                    disabled={isReadOnly}
                    onCheckedChange={(checked) => setWorkday(day.value, checked === true)}
                    aria-label={`${day.label}是否为工作日`}
                  />
                  {day.label}
                </label>
              ))}
            </div>
          </section>

          <DateListEditor
            title="节假日"
            description="这些日期即使落在常规工作日，也按非工作日处理。"
            values={draft.holidays}
            inputValue={holidayInput}
            readOnly={isReadOnly}
            onInputChange={setHolidayInput}
            onAdd={() => addDate('holidays', holidayInput)}
            onRemove={(value) => removeDate('holidays', value)}
          />

          <DateListEditor
            title="调休日"
            description="这些日期即使落在周末，也按工作日处理。"
            values={draft.extraWorkdays}
            inputValue={extraWorkdayInput}
            readOnly={isReadOnly}
            onInputChange={setExtraWorkdayInput}
            onAdd={() => addDate('extraWorkdays', extraWorkdayInput)}
            onRemove={(value) => removeDate('extraWorkdays', value)}
          />
        </CardContent>
      </Card>
    </main>
  )
}

function DateListEditor({
  title,
  description,
  values,
  inputValue,
  readOnly,
  onInputChange,
  onAdd,
  onRemove,
}: {
  title: string
  description: string
  values: string[]
  inputValue: string
  readOnly: boolean
  onInputChange: (value: string) => void
  onAdd: () => void
  onRemove: (value: string) => void
}) {
  return (
    <section className="space-y-3" aria-labelledby={`${title}-title`}>
      <div>
        <h2 id={`${title}-title`} className="text-sm font-medium text-gray-800">
          {title}
        </h2>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="date"
          value={inputValue}
          disabled={readOnly}
          onChange={(event) => onInputChange(event.target.value)}
          aria-label={`添加${title}日期`}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={onAdd}
          disabled={readOnly || !inputValue}
        >
          <Plus className="h-4 w-4" aria-hidden />
          添加
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.length === 0 ? <p className="text-sm text-gray-500">暂无日期</p> : null}
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-gray-50 px-3 text-sm text-gray-700"
          >
            {value}
            <button
              type="button"
              className="rounded-[var(--radius-sm)] p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => onRemove(value)}
              disabled={readOnly}
              aria-label={`删除${title}${value}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </span>
        ))}
      </div>
    </section>
  )
}
