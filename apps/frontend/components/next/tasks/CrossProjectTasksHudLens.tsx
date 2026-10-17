'use client'

import { formatTaskCode } from '@aiproj/types'
import { CopyableCode } from '@/components/next/common/CopyableCode'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { X, Search, ArrowUpDown, ArrowUp, ArrowDown, Bot, User, FolderGit2 } from 'lucide-react'
import { useQuery, QueryClientContext } from '@tanstack/react-query'
import type { Task, TaskPriority, TaskStatus } from '@/lib/api/tasks'
import type { Project } from '@/lib/api/projects'
import { tasksApi } from '@/lib/api/tasks'
import { projectsApi } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'

export interface CrossProjectTasksHudLensProps {
  isOpen?: boolean
  onClose?: () => void
  tasks?: Task[]
  projects?: Project[]
  currentUserId?: number
  defaultFilterProject?: number | null
  defaultFilterStatus?: string
  embedded?: boolean
}

export type SortField = 'name' | 'project' | 'priority' | 'status' | 'dueDate' | 'updatedAt'
export type SortOrder = 'asc' | 'desc'

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  highest: 5,
  high: 4,
  medium: 3,
  low: 2,
  lowest: 1,
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  highest: '最高',
  high: '高',
  medium: '中',
  low: '低',
  lowest: '最低',
}

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  highest: 'bg-[var(--nx-status-danger)] text-[var(--nx-status-danger)]',
  high: 'bg-orange-500 text-orange-500',
  medium: 'bg-amber-500 text-amber-500',
  low: 'bg-blue-400 text-blue-400',
  lowest: 'bg-slate-400 text-slate-400',
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  on_hold: '已挂起',
  cancelled: '已取消',
}

const STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  not_started: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
  in_progress:
    'border-[var(--nx-status-info)]/30 bg-[var(--nx-status-info)]/10 text-[var(--nx-status-info)]',
  completed:
    'border-[var(--nx-status-success)]/30 bg-[var(--nx-status-success)]/10 text-[var(--nx-status-success)]',
  blocked:
    'border-[var(--nx-status-danger)]/30 bg-[var(--nx-status-danger)]/10 text-[var(--nx-status-danger)]',
  on_hold:
    'border-[var(--nx-status-warning)]/30 bg-[var(--nx-status-warning)]/10 text-[var(--nx-status-warning)]',
  cancelled:
    'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)] line-through',
}

/**
 * 跨项目任务高密度 HUD 镜头组件（v3-ui-next-batch3-global-convergence W4 · tasks 4.3）。
 *
 * 规格：
 * - 宽度 `max-w-5xl`（1024px）居中暗黑仪器浮层，Esc 平滑退出；
 * - 36px 行高（精确档 32px）发丝线紧凑表格；
 * - 跨项目任务全景：任务标题、所属项目代码徽标、5 档优先级、6 态状态、负责人（支持 Agent 电光天青）、截止期；
 * - 即时过滤（搜索关键词、项目、状态）与点击表头自由排序；
 * - 点击任务项深链穿透单项目空间：`router.push('/next/projects/:projectId?focusTask=:taskId')` 并关闭镜头。
 */
interface CrossProjectTasksHudLensViewProps extends CrossProjectTasksHudLensProps {
  tasks: Task[]
  projects: Project[]
  isLoading?: boolean
}

function CrossProjectTasksHudLensView({
  isOpen = true,
  onClose,
  tasks: allTasks,
  projects: allProjects,
  currentUserId: propUserId,
  defaultFilterProject = null,
  defaultFilterStatus = 'all',
  embedded = false,
  isLoading = false,
}: CrossProjectTasksHudLensViewProps) {
  const router = useRouter()
  const storeUser = useAuthStore((s) => s.user)
  const effectiveUserId = propUserId ?? storeUser?.id

  // 状态：筛选与排序
  const [searchQuery, setSearchQuery] = React.useState('')
  const [filterProjectId, setFilterProjectId] = React.useState<number | null>(defaultFilterProject)
  const [filterStatus, setFilterStatus] = React.useState<string>(defaultFilterStatus)
  const [sortField, setSortField] = React.useState<SortField>('dueDate')
  const [sortOrder, setSortOrder] = React.useState<SortOrder>('asc')

  // 项目映射表
  const projectMap = React.useMemo(() => {
    const map = new Map<number, Project>()
    for (const p of allProjects) {
      map.set(p.id, p)
    }
    return map
  }, [allProjects])

  // 键盘 Esc 监听
  React.useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // 表头排序切换
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // 过滤与排序计算
  const filteredAndSortedTasks = React.useMemo(() => {
    const result = allTasks.filter((task) => {
      // 关键词搜索
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase()
        const matchName = task.name.toLowerCase().includes(query)
        const project = projectMap.get(task.projectId)
        const matchProject =
          project?.name.toLowerCase().includes(query) ||
          project?.code?.toLowerCase().includes(query)
        if (!matchName && !matchProject) return false
      }

      // 项目筛选
      if (filterProjectId !== null && task.projectId !== filterProjectId) {
        return false
      }

      // 状态筛选
      if (filterStatus !== 'all') {
        if (filterStatus === 'overdue') {
          if (task.status === 'completed' || task.status === 'cancelled') return false
          if (!task.endDate) return false
          if (new Date(task.endDate).getTime() >= Date.now()) return false
        } else if (task.status !== filterStatus) {
          return false
        }
      }

      return true
    })

    // 排序
    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name, 'zh-CN')
          break
        case 'project': {
          const projA = projectMap.get(a.projectId)?.name ?? ''
          const projB = projectMap.get(b.projectId)?.name ?? ''
          cmp = projA.localeCompare(projB, 'zh-CN')
          break
        }
        case 'priority': {
          const pA = PRIORITY_ORDER[a.priority] ?? 0
          const pB = PRIORITY_ORDER[b.priority] ?? 0
          cmp = pA - pB
          break
        }
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '')
          break
        case 'dueDate': {
          if (!a.endDate && !b.endDate) cmp = 0
          else if (!a.endDate) cmp = 1
          else if (!b.endDate) cmp = -1
          else cmp = new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
          break
        }
        case 'updatedAt': {
          const timeA = a.updatedAt
            ? new Date(a.updatedAt).getTime()
            : new Date(a.createdAt).getTime()
          const timeB = b.updatedAt
            ? new Date(b.updatedAt).getTime()
            : new Date(b.createdAt).getTime()
          cmp = timeA - timeB
          break
        }
      }
      return sortOrder === 'asc' ? cmp : -cmp
    })

    return result
  }, [allTasks, searchQuery, filterProjectId, filterStatus, sortField, sortOrder, projectMap])

  // 点击任务行深链穿透单项目空间并关闭镜头
  const handleTaskClick = (task: Task) => {
    onClose?.()
    router.push(`/next/projects/${task.projectId}?focusTask=${task.id}`)
  }

  if (!isOpen) return null

  const innerCard = (
    <div
      className={cn(
        'relative flex max-h-[calc(100dvh-2rem)] min-w-0 w-full max-w-5xl flex-col rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] shadow-2xl overflow-hidden',
        embedded && 'max-h-[72dvh] border-0 shadow-none',
      )}
    >
      {/* 顶部工具栏与标题 */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/95 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-5 w-5 text-[var(--nx-accent)]" aria-hidden />
            <h2 className="text-base font-semibold tracking-tight text-[var(--nx-text-primary)]">
              跨项目任务 HUD 镜头
            </h2>
            <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-0.5 font-mono text-[11px] text-[var(--nx-text-muted)]">
              {filteredAndSortedTasks.length} 项聚焦
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭 HUD 镜头"
            className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 过滤条：搜索框 + 项目选择 + 状态选择 */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 搜索框 */}
          <div className="relative min-w-0 basis-40 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--nx-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索跨项目任务或代码..."
              aria-label="搜索跨项目任务"
              className="h-8 w-full rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] pl-8 pr-3 text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] transition-colors focus:border-[var(--nx-border-focus)] focus:outline-none"
            />
          </div>

          {/* 项目过滤 */}
          <select
            value={filterProjectId ?? ''}
            onChange={(e) => setFilterProjectId(e.target.value ? Number(e.target.value) : null)}
            aria-label="按项目过滤"
            className="h-8 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            <option value="">全部项目</option>
            {allProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code ? `[${p.code}] ` : ''}
                {p.name}
              </option>
            ))}
          </select>

          {/* 状态过滤 */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            aria-label="按状态过滤"
            className="h-8 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            <option value="all">全部状态</option>
            <option value="not_started">待开始</option>
            <option value="in_progress">进行中</option>
            <option value="overdue">已逾期</option>
            <option value="completed">已完成</option>
            <option value="blocked">已阻塞</option>
          </select>
        </div>
      </div>

      {/* 36px / 32px 发丝线紧凑表格容器 */}
      <div
        tabIndex={0}
        role="region"
        aria-label="全域任务，可横向滚动"
        className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"
      >
        <table className="w-full min-w-[640px] border-collapse text-left text-xs" role="table">
          <thead className="sticky top-0 z-10 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/90 backdrop-blur-sm">
            <tr className="h-[36px] [[data-immersion='precise']_&]:h-[32px] text-[var(--nx-text-muted)] font-mono uppercase">
              {/* 任务名称 */}
              <th
                scope="col"
                onClick={() => handleSort('name')}
                className="cursor-pointer px-3 py-1 font-medium transition-colors hover:text-[var(--nx-text-primary)]"
                aria-sort={
                  sortField === 'name' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                <div className="flex items-center gap-1">
                  <span>任务名称</span>
                  {sortField === 'name' ? (
                    sortOrder === 'asc' ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  )}
                </div>
              </th>

              {/* 所属项目 */}
              <th
                scope="col"
                onClick={() => handleSort('project')}
                className="cursor-pointer px-3 py-1 font-medium w-36 transition-colors hover:text-[var(--nx-text-primary)]"
                aria-sort={
                  sortField === 'project'
                    ? sortOrder === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <div className="flex items-center gap-1">
                  <span>所属项目</span>
                  {sortField === 'project' ? (
                    sortOrder === 'asc' ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  )}
                </div>
              </th>

              {/* 优先级 */}
              <th
                scope="col"
                onClick={() => handleSort('priority')}
                className="cursor-pointer px-3 py-1 font-medium w-20 transition-colors hover:text-[var(--nx-text-primary)]"
                aria-sort={
                  sortField === 'priority'
                    ? sortOrder === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <div className="flex items-center gap-1">
                  <span>优先级</span>
                  {sortField === 'priority' ? (
                    sortOrder === 'asc' ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  )}
                </div>
              </th>

              {/* 状态 */}
              <th
                scope="col"
                onClick={() => handleSort('status')}
                className="cursor-pointer px-3 py-1 font-medium w-24 transition-colors hover:text-[var(--nx-text-primary)]"
                aria-sort={
                  sortField === 'status'
                    ? sortOrder === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <div className="flex items-center gap-1">
                  <span>状态</span>
                  {sortField === 'status' ? (
                    sortOrder === 'asc' ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  )}
                </div>
              </th>

              {/* 负责人 */}
              <th scope="col" className="px-3 py-1 font-medium w-28">
                负责人
              </th>

              {/* 截止日期 */}
              <th
                scope="col"
                onClick={() => handleSort('dueDate')}
                className="cursor-pointer px-3 py-1 font-medium w-32 transition-colors hover:text-[var(--nx-text-primary)]"
                aria-sort={
                  sortField === 'dueDate'
                    ? sortOrder === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <div className="flex items-center gap-1">
                  <span>截止日期</span>
                  {sortField === 'dueDate' ? (
                    sortOrder === 'asc' ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  )}
                </div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--nx-border-hairline)]">
            {isLoading && allTasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-xs text-[var(--nx-text-muted)]">
                  正在拉取跨项目任务全景…
                </td>
              </tr>
            ) : filteredAndSortedTasks.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  data-testid="hud-empty"
                  className="py-12 text-center text-xs text-[var(--nx-text-muted)]"
                >
                  未找到匹配的跨项目任务
                </td>
              </tr>
            ) : (
              filteredAndSortedTasks.map((task) => {
                const project = projectMap.get(task.projectId)
                const projectName =
                  project?.name ||
                  (task as unknown as { projectName?: string }).projectName ||
                  `项目 #${task.projectId}`
                const projectCode =
                  project?.code || (task as unknown as { projectCode?: string }).projectCode

                const isOverdue =
                  task.endDate &&
                  new Date(task.endDate).getTime() < Date.now() &&
                  task.status !== 'completed' &&
                  task.status !== 'cancelled'

                const isAgent = task.assigneeType === 'agent'
                const assigneeName = isAgent
                  ? (task.agentAssignee?.name ?? 'AI Agent')
                  : task.assignee?.fullName ||
                    (task.assigneeId === effectiveUserId
                      ? '我'
                      : task.assigneeId
                        ? `成员 #${task.assigneeId}`
                        : '未指派')

                return (
                  <tr
                    key={task.id}
                    data-task-row=""
                    data-task-id={task.id}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleTaskClick(task)
                      }
                    }}
                    onClick={() => handleTaskClick(task)}
                    className="h-[36px] [[data-immersion='precise']_&]:h-[32px] cursor-pointer transition-colors select-none hover:bg-[var(--nx-bg-1)] focus:bg-[var(--nx-bg-1)] focus:outline-none text-[var(--nx-text-secondary)]"
                  >
                    {/* 任务名称 */}
                    <td className="px-3 py-1 font-medium text-[var(--nx-text-primary)] max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        <span className="truncate" title={task.name}>
                          {task.name}
                        </span>
                        <CopyableCode
                          code={formatTaskCode(
                            { id: task.projectId, code: projectCode ?? null },
                            task.id,
                          )}
                          className="shrink-0 border-transparent px-0 py-0 text-[10px]"
                        />
                      </div>
                    </td>

                    {/* 所属项目徽标与代码 */}
                    <td className="px-3 py-1">
                      <div className="flex items-center gap-1.5 truncate">
                        {projectCode && (
                          <CopyableCode
                            code={projectCode}
                            className="border-transparent px-0 py-0 text-[10px]"
                          />
                        )}
                        <span
                          className="truncate text-xs text-[var(--nx-text-muted)]"
                          title={projectName}
                        >
                          {projectName}
                        </span>
                      </div>
                    </td>

                    {/* 优先级 */}
                    <td className="px-3 py-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            PRIORITY_COLORS[task.priority]?.split(' ')[0] ?? 'bg-slate-400'
                          }`}
                        />
                        <span className="text-[11px] text-[var(--nx-text-muted)]">
                          {PRIORITY_LABELS[task.priority] ?? task.priority}
                        </span>
                      </div>
                    </td>

                    {/* 状态徽标 */}
                    <td className="px-3 py-1">
                      <span
                        className={`inline-flex items-center rounded border px-1.5 py-0.2 text-[10px] font-mono ${
                          STATUS_BADGE_CLASSES[task.status] ?? ''
                        }`}
                      >
                        {STATUS_LABELS[task.status] ?? task.status}
                      </span>
                    </td>

                    {/* 负责人（支持 Agent 电光天青） */}
                    <td className="px-3 py-1">
                      <div className="flex items-center gap-1.5 truncate">
                        {isAgent ? (
                          <Bot
                            className="h-3.5 w-3.5 shrink-0 text-cyan-400"
                            aria-label="AI Agent 负责人"
                          />
                        ) : (
                          <User className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" />
                        )}
                        <span
                          className={`truncate text-xs ${
                            isAgent ? 'font-medium text-cyan-300' : 'text-[var(--nx-text-muted)]'
                          }`}
                        >
                          {assigneeName}
                        </span>
                      </div>
                    </td>

                    {/* 截止日期 */}
                    <td className="px-3 py-1 font-mono text-[11px]">
                      {task.endDate ? (
                        <span
                          className={
                            isOverdue
                              ? 'font-semibold text-[var(--nx-status-danger)]'
                              : 'text-[var(--nx-text-muted)]'
                          }
                        >
                          {task.endDate.slice(0, 10)}
                          {isOverdue && ' (逾期)'}
                        </span>
                      ) : (
                        <span className="text-[var(--nx-text-muted)]">-</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 底部操作提示栏 */}
      <div className="flex items-center justify-between border-t border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-2 text-[11px] text-[var(--nx-text-muted)] font-mono">
        <span>单击任意任务穿透至对应项目并呼出详情抽屉</span>
        <span>按 ESC 键平滑退出</span>
      </div>
    </div>
  )

  if (embedded) {
    return (
      <div
        role="region"
        aria-label="跨项目任务 HUD 镜头"
        data-tasks-hud-lens
        data-testid="cross-project-tasks-hud"
        className="w-full"
      >
        {innerCard}
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="跨项目任务 HUD 镜头"
      data-tasks-hud-lens
      data-testid="cross-project-tasks-hud"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
    >
      {innerCard}
    </div>
  )
}

function CrossProjectTasksHudLensLive(props: CrossProjectTasksHudLensProps) {
  const currentOrganizationId = useAuthStore((s) => s.currentOrganizationId)
  const { data: remoteData, isLoading } = useQuery({
    queryKey: ['cross-project-tasks', currentOrganizationId],
    queryFn: async () => {
      const projRes = await projectsApi.list({ perPage: 20 })
      const projects = projRes.data ?? []
      const taskArrays = await Promise.all(
        projects.map(async (p) => {
          try {
            const tRes = await tasksApi.list(p.id, { perPage: 100 })
            return (tRes.data ?? []).map((t) => ({
              ...t,
              projectName: p.name,
              projectCode: p.code,
            }))
          } catch {
            return []
          }
        }),
      )
      return {
        projects,
        tasks: taskArrays.flat(),
      }
    },
    enabled: props.isOpen !== false && props.tasks === undefined && currentOrganizationId !== null,
    staleTime: 60_000,
  })

  return (
    <CrossProjectTasksHudLensView
      {...props}
      tasks={props.tasks ?? remoteData?.tasks ?? []}
      projects={props.projects ?? remoteData?.projects ?? []}
      isLoading={isLoading}
    />
  )
}

export function CrossProjectTasksHudLens(props: CrossProjectTasksHudLensProps) {
  if (props.isOpen === false) return null
  const hasQueryClient = React.useContext(QueryClientContext) !== undefined
  if (props.tasks) {
    return (
      <CrossProjectTasksHudLensView
        {...props}
        tasks={props.tasks}
        projects={props.projects ?? []}
      />
    )
  }
  if (!hasQueryClient) {
    return null
  }
  return <CrossProjectTasksHudLensLive {...props} />
}

export default CrossProjectTasksHudLens
