'use client'

import { useQueries, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { PageReadinessBanner } from '@/components/help/PageReadinessBanner'
import { calendarApi, calendarKeys, type CalendarFilters } from '@/lib/api/calendar'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import { buildMonthGrid, groupTasksByDue, toIsoDate } from '@/lib/cross-project-tasks'
import { readinessFor } from '@/lib/help/readiness'
import { useAuthStore } from '@/stores/auth-store'

const PROJECT_LIMIT = 50
/** 后端日历 perPage 上限。 */
const PER_PROJECT_LIMIT = 200
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MAX_ITEMS_PER_DAY = 3

/**
 * `/calendar` 全局日历：跨项目按截止日汇总任务与里程碑的月视图。
 *
 * 复用项目级日历接口（deadline 模式）按项目并行拉取后聚合，无新增后端端点；
 * 可切换「只看我的」，单项目失败单独提示，不拖垮整页。
 */
export default function CalendarPage() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [mineOnly, setMineOnly] = useState(false)

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])

  const projectsQuery = useQuery({
    queryKey: projectKeys.list(organizationId ?? 0, { perPage: PROJECT_LIMIT }),
    queryFn: () => projectsApi.list({ perPage: PROJECT_LIMIT }),
    enabled: organizationId !== null,
  })
  const projects = useMemo(() => projectsQuery.data?.data ?? [], [projectsQuery.data])

  const filters: CalendarFilters = useMemo(
    () => ({
      view: 'month',
      anchorDate: grid.dateFrom,
      dateFrom: grid.dateFrom,
      dateTo: grid.dateTo,
      perPage: PER_PROJECT_LIMIT,
      ...(mineOnly && userId ? { assigneeId: String(userId) } : {}),
    }),
    [grid.dateFrom, grid.dateTo, mineOnly, userId],
  )

  const calendarQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: calendarKeys.list(project.id, filters),
      queryFn: () => calendarApi.list(project.id, filters),
    })),
  })

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )
  const tasks = calendarQueries.flatMap((q) => q.data?.data ?? [])
  const byDay = groupTasksByDue(tasks)
  const failedProjects = projects.filter((_, index) => calendarQueries[index]?.isError)
  const loading = projectsQuery.isLoading || calendarQueries.some((q) => q.isLoading)
  const today = toIsoDate(new Date())

  const shiftMonth = (delta: number) =>
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })

  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }

  return (
    <div className="space-y-6 py-6" data-testid="global-calendar-page">
      <h1 className="text-2xl font-semibold tracking-tight">日历</h1>
      <PageReadinessBanner readiness={readinessFor('/calendar')!} helpArticleTitle="项目视图总览" />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" aria-label="上个月" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span
          className="min-w-[7rem] text-center text-base font-medium"
          data-testid="calendar-month"
        >
          {cursor.year} 年 {cursor.month + 1} 月
        </span>
        <Button variant="outline" size="sm" aria-label="下个月" onClick={() => shiftMonth(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const now = new Date()
            setCursor({ year: now.getFullYear(), month: now.getMonth() })
          }}
        >
          今天
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          只看我的
        </label>
        <span className="text-sm text-muted-foreground">
          本月截止 {tasks.length} 项 · 覆盖 {projects.length} 个项目
        </span>
        <Link
          href="/settings/integrations?category=calendar"
          className="ml-auto text-sm text-primary hover:underline"
        >
          绑定外部日历
        </Link>
      </div>

      {failedProjects.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            以下项目的日历加载失败（可能无权限或服务异常）：
            {failedProjects.map((p) => p.name).join('、')}
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-[480px] w-full" />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-lg border text-sm">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="border-b bg-muted/40 px-2 py-1.5 text-center text-xs text-muted-foreground"
              >
                周{w}
              </div>
            ))}
            {grid.days.map((day) => {
              const items = byDay.get(day.iso) ?? []
              return (
                <div
                  key={day.iso}
                  data-calendar-day={day.iso}
                  className={`min-h-[96px] border-b border-r p-1.5 ${day.inMonth ? '' : 'bg-muted/20 text-muted-foreground'}`}
                >
                  <div
                    className={`mb-1 text-xs ${day.iso === today ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground' : ''}`}
                  >
                    {day.day}
                  </div>
                  <ul className="space-y-0.5">
                    {items.slice(0, MAX_ITEMS_PER_DAY).map((task) => (
                      <li key={`${task.projectId}-${task.id}`}>
                        <Link
                          href={`/projects/${task.projectId}/tasks`}
                          title={`${projectNameById.get(task.projectId) ?? ''} · ${task.name}`}
                          className={`block truncate rounded px-1 py-0.5 text-xs hover:underline ${task.taskType === 'milestone' ? 'bg-amber-100 text-amber-900' : task.status === 'completed' ? 'bg-muted text-muted-foreground line-through' : 'bg-primary/10 text-primary'}`}
                        >
                          {task.taskType === 'milestone' ? '◆ ' : ''}
                          {task.name}
                        </Link>
                      </li>
                    ))}
                    {items.length > MAX_ITEMS_PER_DAY && (
                      <li className="px-1 text-xs text-muted-foreground">
                        还有 {items.length - MAX_ITEMS_PER_DAY} 项
                      </li>
                    )}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
