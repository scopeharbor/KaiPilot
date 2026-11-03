'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Columns3,
  Filter,
  ListChecks,
  ListTree,
  PanelRight,
  Plus,
  RotateCcw,
  Search,
  Sigma,
} from 'lucide-react'
import { TaskListTable, type TaskInlinePatch } from '@/components/views/list/TaskListTable'
import { TaskBatchActionBar } from '@/components/views/tasks/TaskBatchActionBar'
import { TaskBatchResultAlert } from '@/components/views/tasks/TaskBatchResultAlert'
import { TaskDetailDrawer, TaskSplitPanel } from '@/components/views/tasks/TaskDetailDrawer'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useListViewUrlState, useTaskListView } from '@/hooks/use-list-view'
import { usePermissions } from '@/hooks/use-permissions'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import { useTaskSelection } from '@/hooks/use-task-selection'
import { projectKeys, projectMembersApi } from '@/lib/api/projects'
import {
  LIST_GROUP_FIELDS,
  type ListGroupField,
  type ListSortTerm,
  type TaskListViewFilters,
} from '@/lib/api/list-view'
import {
  tasksApi,
  type Task,
  type TaskBatchInput,
  type TaskBatchResult,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import {
  TASK_TABLE_COLUMN_LABELS,
  TASK_TABLE_GROUP_LABELS,
  TASK_TABLE_OPTIONAL_COLUMNS,
  useTaskTableStore,
} from '@/stores/task-table-store'

const STATUS_OPTIONS: Array<[TaskStatus, string]> = [
  ['not_started', '未开始'],
  ['in_progress', '进行中'],
  ['completed', '已完成'],
  ['blocked', '受阻'],
  ['on_hold', '已暂停'],
  ['cancelled', '已取消'],
]

const PRIORITY_OPTIONS: Array<[TaskPriority, string]> = [
  ['highest', '最高'],
  ['high', '高'],
  ['medium', '中'],
  ['low', '低'],
  ['lowest', '最低'],
]

export function TaskListViewContent({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const { state, update } = useListViewUrlState()
  const selection = useTaskSelection()
  const [searchInput, setSearchInput] = useState(state.search ?? '')
  const [newTaskName, setNewTaskName] = useState('')
  const newTaskInputRef = useRef<HTMLInputElement>(null)
  const focusNewTask = useSearchParams().get('newTask') === '1'
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [batchResult, setBatchResult] = useState<TaskBatchResult | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  // OpenProject 式「配置视图」：显示列、分组、合计（个人偏好，存本机；v3-classic-ui-openproject-table）
  const tableColumns = useTaskTableStore((s) => s.columns)
  const groupBy = useTaskTableStore((s) => s.groupBy)
  const showSums = useTaskTableStore((s) => s.showSums)
  const setColumnVisible = useTaskTableStore((s) => s.setColumnVisible)
  const setGroupBy = useTaskTableStore((s) => s.setGroupBy)
  const setShowSums = useTaskTableStore((s) => s.setShowSums)
  const queryFilters = useMemo<TaskListViewFilters>(
    () => ({ ...state, groupBy: groupBy ?? undefined, sums: showSums || undefined }),
    [groupBy, showSums, state],
  )
  const list = useTaskListView(projectId, queryFilters)
  const members = useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectMembersApi.list(projectId),
  })
  const memberOptions = useMemo(
    () =>
      (members.data ?? []).map(
        (member) =>
          [
            member.userId,
            member.user?.fullName || member.user?.email || `成员 #${member.userId}`,
          ] as const,
      ),
    [members.data],
  )
  const memberNames = useMemo(() => new Map(memberOptions), [memberOptions])
  const [pendingTaskIds, setPendingTaskIds] = useState<ReadonlySet<number>>(() => new Set())
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [inlineWarnings, setInlineWarnings] = useState<string[]>([])

  useEffect(() => setSearchInput(state.search ?? ''), [state.search])
  // 命令面板「新建任务」上下文命令导航到 ?newTask=1：聚焦快速新建输入框（预填上下文）。
  useEffect(() => {
    if (focusNewTask && can('task:create')) {
      newTaskInputRef.current?.focus()
    }
  }, [focusNewTask])
  useEffect(() => {
    const normalized = searchInput.trim()
    if (normalized === (state.search ?? '')) return
    const timer = window.setTimeout(
      () => update({ search: normalized || undefined }, { replace: true }),
      300,
    )
    return () => window.clearTimeout(timer)
  }, [searchInput, state.search, update])

  const createTask = useMutation({
    mutationFn: (name: string) => tasksApi.create(projectId, { name }),
    onSuccess: async () => {
      setNewTaskName('')
      await invalidateTaskQueries(queryClient, projectId)
    },
  })
  // 行内编辑：状态走状态流转接口（服务端校验流转），其余字段走任务更新接口（带依赖顺延提示）。
  const inlineEdit = useMutation({
    mutationFn: async ({ task, patch }: { task: Task; patch: TaskInlinePatch }) => {
      if ('status' in patch) {
        await tasksApi.changeStatus(projectId, task.id, { status: patch.status })
        return [] as string[]
      }
      const result = await tasksApi.updateWithWarnings(projectId, task.id, patch)
      return result.warnings
    },
    onMutate: ({ task }) => {
      setInlineError(null)
      setPendingTaskIds((previous) => new Set(previous).add(task.id))
    },
    onSuccess: async (warnings) => {
      setInlineWarnings(warnings)
      await invalidateTaskQueries(queryClient, projectId)
    },
    onError: (error, { task }) => {
      setInlineWarnings([])
      setInlineError(
        `任务 #${task.id} 未更新：${(error as { message?: string }).message ?? '请稍后重试。'}`,
      )
    },
    onSettled: (_data, _error, { task }) => {
      setPendingTaskIds((previous) => {
        const next = new Set(previous)
        next.delete(task.id)
        return next
      })
    },
  })
  const batch = useMutation({
    mutationFn: (input: TaskBatchInput) => tasksApi.batch(projectId, input),
    onSuccess: async (result) => {
      setBatchResult(result)
      selection.retain(result.results.filter((item) => !item.success).map((item) => item.taskId))
      await invalidateTaskQueries(queryClient, projectId)
    },
  })

  const rows = list.data?.data ?? []
  // OpenProject 式工具列：「筛选」按钮展开筛选面板；宽屏下任务详情以拆分面板停靠在表格右侧
  // （v3-classic-ui-openproject-parity），窄屏仍用抽屉。
  const filterCount =
    (state.statuses?.length ? 1 : 0) +
    (state.priorities?.length ? 1 : 0) +
    (state.assigneeIds?.length ? 1 : 0) +
    (state.dateFrom || state.dateTo ? 1 : 0)
  const [filtersOpen, setFiltersOpen] = useState(filterCount > 0)
  const [splitMode, setSplitMode] = useState(true)
  const wide = useMediaQuery('(min-width: 1280px)')
  const splitOpen = wide && splitMode && selectedTaskId !== null
  const hasFilters = Boolean(
    state.search ||
    state.statuses?.length ||
    state.priorities?.length ||
    state.assigneeIds?.length ||
    state.dateFrom ||
    state.dateTo,
  )

  function submitNewTask(event: FormEvent) {
    event.preventDefault()
    const name = newTaskName.trim()
    if (name) createTask.mutate(name)
  }

  function toggleTask(taskId: number, checked: boolean) {
    if (checked && !selection.selectedIds.has(taskId) && selection.selectedIds.size >= 100) {
      setSelectionError('一次最多选择 100 项任务。')
      return
    }
    setSelectionError(null)
    selection.toggle(taskId, checked)
  }

  function togglePage(taskIds: number[], checked: boolean) {
    const additions = taskIds.filter((id) => !selection.selectedIds.has(id)).length
    if (checked && selection.selectedIds.size + additions > 100) {
      setSelectionError('选择当前页会超过 100 项上限，请先清除部分已选任务。')
      return
    }
    setSelectionError(null)
    selection.setPageSelected(taskIds, checked)
  }

  function setFilter<K extends keyof TaskListViewFilters>(key: K, value: TaskListViewFilters[K]) {
    update({ [key]: value }, { replace: false })
  }

  function clearFilters() {
    setSearchInput('')
    update(
      {
        search: undefined,
        statuses: undefined,
        priorities: undefined,
        assigneeIds: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        page: 1,
      },
      { resetPage: false, replace: false },
    )
  }

  return (
    <div className="space-y-4 pb-12 pt-4">
      {/* OpenProject 式视图工具列：标题 + 一行说明，操作在右（v3-classic-ui-openproject-views） */}
      <header
        data-view-toolbar
        className="flex flex-col gap-3 border-b border-border pb-3 xl:flex-row xl:items-end xl:justify-between"
      >
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-800">任务列表</h2>
          <p className="mt-0.5 max-w-3xl text-xs text-gray-500">
            在同一张高密度列表中比较进度、负责人、截止日与工时；排序不会改变看板或 WBS 顺序。
          </p>
        </div>
        {can('task:create') ? (
          <form className="flex w-full gap-2 xl:max-w-md" onSubmit={submitNewTask}>
            <Input
              ref={newTaskInputRef}
              value={newTaskName}
              maxLength={255}
              aria-label="新任务名称"
              placeholder="快速新建任务"
              onChange={(event) => setNewTaskName(event.target.value)}
            />
            <Button type="submit" loading={createTask.isPending} disabled={!newTaskName.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              新建
            </Button>
          </form>
        ) : null}
      </header>

      <TaskBatchResultAlert result={batchResult} />
      {selectionError ? (
        <Alert variant="warning" title="选择数量受限">
          {selectionError}
        </Alert>
      ) : null}
      {createTask.isError ? (
        <Alert variant="danger" title="新建任务失败">
          {(createTask.error as { message?: string }).message ?? '请稍后重试。'}
        </Alert>
      ) : null}
      {inlineError ? (
        <Alert variant="danger" title="行内修改失败">
          {inlineError}
        </Alert>
      ) : null}
      {inlineWarnings.length ? (
        <Alert variant="info" title="已更新">
          {inlineWarnings.join('；')}
        </Alert>
      ) : null}
      {batch.isError ? (
        <Alert variant="danger" title="批量操作失败">
          {(batch.error as { message?: string }).message ?? '请稍后重试。'}
        </Alert>
      ) : null}

      <div
        data-list-split={splitOpen || undefined}
        className={cn(
          'min-w-0',
          splitOpen && 'grid grid-cols-[minmax(0,1fr)_420px] items-start gap-4',
        )}
      >
        <Card variant="outlined" className="min-w-0">
          <CardContent className="p-0">
            <div data-list-toolbar className="border-b border-border">
              <div className="flex flex-wrap items-center gap-2 px-[var(--card-pad)] py-2.5">
                <label className="relative block min-w-0 flex-1 sm:max-w-sm">
                  <span className="sr-only">搜索任务名称或编号</span>
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                    aria-hidden
                  />
                  <Input
                    className="pl-9"
                    value={searchInput}
                    placeholder="搜索任务名称或编号"
                    onChange={(event) => setSearchInput(event.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  aria-expanded={filtersOpen}
                  aria-controls="task-list-filters"
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <Filter className="h-4 w-4" aria-hidden />
                  筛选
                  {filterCount ? (
                    <span className="rounded-full bg-primary-100 px-1.5 text-xs text-primary-700">
                      {filterCount}
                    </span>
                  ) : null}
                </Button>
                {hasFilters ? (
                  <Button type="button" variant="ghost" onClick={clearFilters}>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    清除筛选
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="secondary">
                      <Columns3 className="h-4 w-4" aria-hidden />列
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-44">
                    <DropdownMenuLabel>显示列</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TASK_TABLE_OPTIONAL_COLUMNS.map((column) => (
                      <DropdownMenuCheckboxItem
                        key={column}
                        checked={tableColumns.includes(column)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) => setColumnVisible(column, checked === true)}
                      >
                        {TASK_TABLE_COLUMN_LABELS[column]}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="secondary">
                      <ListTree className="h-4 w-4" aria-hidden />
                      {groupBy ? `分组：${TASK_TABLE_GROUP_LABELS[groupBy]}` : '分组'}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-40">
                    <DropdownMenuLabel>分组依据</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioGroup
                      value={groupBy ?? 'none'}
                      onValueChange={(value) =>
                        setGroupBy(value === 'none' ? null : (value as ListGroupField))
                      }
                    >
                      <DropdownMenuRadioItem value="none">不分组</DropdownMenuRadioItem>
                      {LIST_GROUP_FIELDS.map((field) => (
                        <DropdownMenuRadioItem key={field} value={field}>
                          {TASK_TABLE_GROUP_LABELS[field]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  type="button"
                  variant="secondary"
                  aria-pressed={showSums}
                  title="在表格底部与组头显示整份结果的合计"
                  onClick={() => setShowSums(!showSums)}
                >
                  <Sigma className="h-4 w-4" aria-hidden />
                  合计
                </Button>
                <p className="ml-auto text-sm text-gray-500" aria-live="polite">
                  共 {list.data?.meta.total ?? 0} 项
                  {selection.selectedIds.size ? ` · 已选 ${selection.selectedIds.size} 项` : ''}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="hidden xl:inline-flex"
                  aria-pressed={splitMode}
                  title="在表格右侧显示任务详情"
                  onClick={() => setSplitMode((on) => !on)}
                >
                  <PanelRight className="h-4 w-4" aria-hidden />
                  拆分视图
                </Button>
              </div>
              {filtersOpen ? (
                <div
                  id="task-list-filters"
                  data-list-filter-panel
                  className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-[var(--card-pad)] py-2.5"
                >
                  <MultiFilter
                    label="状态"
                    values={state.statuses ?? []}
                    options={STATUS_OPTIONS}
                    onChange={(values) => setFilter('statuses', values.length ? values : undefined)}
                  />
                  <MultiFilter
                    label="优先级"
                    values={state.priorities ?? []}
                    options={PRIORITY_OPTIONS}
                    onChange={(values) =>
                      setFilter('priorities', values.length ? values : undefined)
                    }
                  />
                  <MultiFilter
                    label="负责人"
                    values={state.assigneeIds ?? []}
                    options={(members.data ?? []).map((member) => [
                      member.userId,
                      member.user?.fullName || member.user?.email || `成员 #${member.userId}`,
                    ])}
                    onChange={(values) =>
                      setFilter('assigneeIds', values.length ? values : undefined)
                    }
                  />
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    截止日从
                    <Input
                      className="h-9 w-auto"
                      type="date"
                      value={state.dateFrom ?? ''}
                      onChange={(event) => setFilter('dateFrom', event.target.value || undefined)}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    到
                    <Input
                      className="h-9 w-auto"
                      type="date"
                      value={state.dateTo ?? ''}
                      onChange={(event) => setFilter('dateTo', event.target.value || undefined)}
                    />
                  </label>
                </div>
              ) : null}
            </div>

            {list.isLoading ? <ListSkeleton /> : null}
            {list.isError ? (
              <div className="p-[var(--card-pad)]">
                <Alert variant="danger" title="任务列表加载失败">
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => list.refetch()}
                    >
                      重试
                    </Button>
                  </div>
                </Alert>
              </div>
            ) : null}
            {list.data && rows.length === 0 ? (
              <EmptyState
                icon={hasFilters ? Filter : ListChecks}
                title={hasFilters ? '没有符合条件的任务' : '这个项目还没有任务'}
                description={
                  hasFilters
                    ? '调整或清除筛选条件，再看看其他任务。'
                    : can('task:create')
                      ? '从右上角快速新建第一项任务。'
                      : '有权限的项目成员创建任务后会显示在这里。'
                }
                action={
                  hasFilters ? (
                    <Button type="button" variant="secondary" onClick={clearFilters}>
                      清除筛选
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            {rows.length ? (
              <TaskListTable
                rows={rows}
                sort={state.sort as ListSortTerm[]}
                selectedIds={selection.selectedIds}
                onSortChange={(sort) => setFilter('sort', sort)}
                onToggle={toggleTask}
                onTogglePage={togglePage}
                onOpen={setSelectedTaskId}
                columns={tableColumns}
                groupBy={groupBy}
                groups={list.data?.meta.groups}
                sums={showSums ? list.data?.meta.sums : undefined}
                memberNames={memberNames}
                editing={{
                  canUpdate: can('task:update'),
                  canAssign: can('task:assign'),
                  members: memberOptions,
                  pendingTaskIds,
                  onEdit: (task, patch) => inlineEdit.mutate({ task, patch }),
                }}
              />
            ) : null}

            {list.data && list.data.meta.total > 0 ? (
              <div className="flex flex-col gap-3 border-t border-border px-[var(--card-pad)] py-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-500">
                  每页
                  <select
                    className="h-9 rounded-[var(--radius-md)] border border-border bg-gray-0 px-2 text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    value={state.perPage}
                    onChange={(event) =>
                      update(
                        { perPage: Number(event.target.value), page: 1 },
                        { resetPage: false, replace: false },
                      )
                    }
                  >
                    {[20, 50, 100].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  项
                </label>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="text-sm tabular-nums text-gray-500">
                    第 {list.data.meta.page} / {Math.max(1, list.data.meta.totalPages)} 页
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={state.page <= 1}
                    onClick={() =>
                      update({ page: state.page - 1 }, { resetPage: false, replace: false })
                    }
                  >
                    上一页
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={state.page >= list.data.meta.totalPages}
                    onClick={() =>
                      update({ page: state.page + 1 }, { resetPage: false, replace: false })
                    }
                  >
                    下一页
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
        {splitOpen && selectedTaskId !== null ? (
          <TaskSplitPanel
            projectId={projectId}
            taskId={selectedTaskId}
            onClose={() => setSelectedTaskId(null)}
          />
        ) : null}
      </div>

      <TaskBatchActionBar
        selectedIds={[...selection.selectedIds]}
        members={members.data ?? []}
        pending={batch.isPending}
        onClear={() => {
          setSelectionError(null)
          selection.clear()
        }}
        onExecute={(input) => batch.mutate(input)}
      />
      <TaskDetailDrawer
        projectId={projectId}
        taskId={splitOpen ? null : selectedTaskId}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null)
        }}
      />
    </div>
  )
}

function MultiFilter<T extends string | number>({
  label,
  values,
  options,
  onChange,
}: {
  label: string
  values: T[]
  options: Array<[T, string]>
  onChange: (values: T[]) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" className="justify-between">
          {label}
          {values.length ? (
            <span className="rounded-full bg-primary-100 px-1.5 text-xs text-primary-700">
              {values.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-52 overflow-y-auto">
        <DropdownMenuLabel>{label}筛选</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map(([value, optionLabel]) => (
          <DropdownMenuCheckboxItem
            key={String(value)}
            checked={values.includes(value)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onChange(
                checked ? [...values, value] : values.filter((selected) => selected !== value),
              )
            }
          >
            {optionLabel}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-[var(--card-pad)]" aria-label="正在加载任务列表">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-[var(--row-h)] w-full" />
      ))}
    </div>
  )
}
