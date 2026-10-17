'use client'

import { formatProjectCode } from '@aiproj/types'
import { CopyableCode } from '@/components/next/common/CopyableCode'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, FolderGit2, Plus, Search } from 'lucide-react'
import {
  projectsApi,
  projectKeys,
  type Project,
  type ProjectPriority,
  type ProjectStatus,
} from '@/lib/api/projects'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

export interface SpaceMapProjectListLensProps {
  /** 外部传入的项目列表（主要用于单元测试与受控场景，未传入则默认使用 TanStack Query） */
  projects?: Project[]
  /** 选中项目后的回调（默认关闭浮层并 router.push('/next/projects/:id')） */
  onSelectProject?: (project: Project) => void
  /** 关闭浮层回调 */
  onClose?: () => void
  /** 触发放置立项弹窗或抽屉的回调；未传入则默认跳转 /next/create?mode=manual */
  onOpenPlacement?: () => void
}

type SortField = 'name' | 'updatedAt' | 'priority'
type SortOrder = 'asc' | 'desc'

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '进行中',
  planning: '计划中',
  on_hold: '暂停',
  completed: '已完成',
  draft: '草稿',
  cancelled: '已取消',
  archived: '已归档',
}

const PRIORITY_LABELS: Record<ProjectPriority, string> = {
  critical: '紧急',
  high: '高',
  medium: '中',
  low: '低',
}

const PRIORITY_ORDER: Record<ProjectPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export function SpaceMapProjectListLens({
  projects: propProjects,
  onSelectProject,
  onClose,
  onOpenPlacement,
}: SpaceMapProjectListLensProps) {
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canCreate = hasPermission('project:create')
  const orgId = selectEffectiveOrganizationId({ currentOrganizationId, user }) ?? 0

  const [searchInput, setSearchInput] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<string>('all')
  const [sortField, setSortField] = React.useState<SortField>('updatedAt')
  const [sortOrder, setSortOrder] = React.useState<SortOrder>('desc')
  const [focusedIndex, setFocusedIndex] = React.useState<number>(0)

  // 300ms 防抖搜索
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // TanStack Query：当未显式传入 propProjects 时拉取数据
  const queryFilters = React.useMemo(() => {
    return {
      search: debouncedSearch || undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      perPage: 100,
    }
  }, [debouncedSearch, statusFilter])

  const { data: queryData, isLoading } = useQuery({
    queryKey: projectKeys.list(orgId, queryFilters),
    queryFn: () => projectsApi.list(queryFilters),
    enabled: propProjects === undefined && orgId > 0,
  })

  const rawProjects = React.useMemo(() => {
    if (propProjects !== undefined) return propProjects
    return queryData?.data ?? []
  }, [propProjects, queryData])

  // 客户端过滤与排序（当使用 propProjects 或二次实时精排）
  const filteredAndSortedProjects = React.useMemo(() => {
    let result = rawProjects

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.code && p.code.toLowerCase().includes(q)),
      )
    }

    if (statusFilter !== 'all') {
      result = result.filter((p) => p.status === statusFilter)
    }

    return [...result].sort((a, b) => {
      let comparison = 0
      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name, 'zh-CN')
      } else if (sortField === 'updatedAt') {
        const timeA = new Date(a.updatedAt || a.createdAt).getTime()
        const timeB = new Date(b.updatedAt || b.createdAt).getTime()
        comparison = timeA - timeB
      } else if (sortField === 'priority') {
        comparison = (PRIORITY_ORDER[a.priority] ?? 0) - (PRIORITY_ORDER[b.priority] ?? 0)
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })
  }, [rawProjects, debouncedSearch, statusFilter, sortField, sortOrder])

  // 当结果集变化时重置游标至首行
  React.useEffect(() => {
    setFocusedIndex(0)
  }, [filteredAndSortedProjects.length, debouncedSearch, statusFilter])

  const handleSelect = React.useCallback(
    (project: Project) => {
      onClose?.()
      if (onSelectProject) {
        onSelectProject(project)
      } else {
        router.push(`/next/projects/${project.id}`)
      }
    },
    [onClose, onSelectProject, router],
  )

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (filteredAndSortedProjects.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setFocusedIndex((prev) => (prev + 1) % filteredAndSortedProjects.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setFocusedIndex(
        (prev) => (prev - 1 + filteredAndSortedProjects.length) % filteredAndSortedProjects.length,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = filteredAndSortedProjects[focusedIndex]
      if (target) {
        handleSelect(target)
      }
    }
  }

  const handleCreateProject = () => {
    if (!canCreate) return
    if (onOpenPlacement) {
      onOpenPlacement()
    } else {
      onClose?.()
      router.push('/next/create?mode=manual')
    }
  }

  return (
    <div
      data-testid="space-map-project-list-lens"
      data-space-map-project-list-lens=""
      className="flex flex-col gap-3 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="空间地图项目清单镜头"
    >
      {/* 顶部工具栏：搜索框、状态过滤、放置立项入口 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-0 basis-40 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]"
              aria-hidden
            />
            <input
              type="search"
              aria-label="搜索项目名称或代码"
              placeholder="搜索项目名称或代号（300ms 防抖）…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] pl-8 pr-3 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
            />
          </div>

          <select
            aria-label="过滤项目状态"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-xs text-[var(--nx-text-secondary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            <option value="all">全部状态</option>
            <option value="active">进行中</option>
            <option value="planning">计划中</option>
            <option value="on_hold">暂停</option>
            <option value="completed">已完成</option>
            <option value="draft">草稿</option>
          </select>
        </div>

        {canCreate && (
          <button
            type="button"
            data-testid="btn-placement-create"
            onClick={handleCreateProject}
            aria-label="放置立项"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/10 px-3 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-accent)]/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            <span>+ 放置立项</span>
          </button>
        )}
      </div>

      {/* 高密度紧凑表格容器（36px 行高，精确档 32px，1px 发丝线网格） */}
      <div
        tabIndex={0}
        role="region"
        aria-label="项目清单，可横向滚动"
        className="max-h-[60dvh] min-w-0 overflow-auto overscroll-contain rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
      >
        <table className="w-full min-w-[640px] border-collapse text-left text-xs" role="table">
          <thead className="sticky top-0 z-10 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/90 backdrop-blur-sm">
            <tr className="h-[36px] [[data-immersion='precise']_&]:h-[32px] text-[var(--nx-text-muted)] font-mono uppercase">
              <th
                scope="col"
                onClick={() => handleSort('name')}
                className="cursor-pointer px-3 py-1 font-medium transition-colors hover:text-[var(--nx-text-primary)]"
                aria-sort={
                  sortField === 'name' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                <div className="flex items-center gap-1">
                  <span>项目名称</span>
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
              <th scope="col" className="px-3 py-1 font-medium w-28">
                标识代码
              </th>
              <th scope="col" className="px-3 py-1 font-medium w-24">
                状态
              </th>
              <th
                scope="col"
                onClick={() => handleSort('priority')}
                className="cursor-pointer px-3 py-1 font-medium w-20 transition-colors hover:text-[var(--nx-text-primary)]"
              >
                优先级
              </th>
              <th scope="col" className="px-3 py-1 font-medium w-28">
                拥有者
              </th>
              <th
                scope="col"
                onClick={() => handleSort('updatedAt')}
                className="cursor-pointer px-3 py-1 font-medium w-32 transition-colors hover:text-[var(--nx-text-primary)]"
                aria-sort={
                  sortField === 'updatedAt'
                    ? sortOrder === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <div className="flex items-center gap-1">
                  <span>最后更新</span>
                  {sortField === 'updatedAt' ? (
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
            {isLoading && propProjects === undefined ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-[var(--nx-text-muted)]">
                  正在加载项目列表…
                </td>
              </tr>
            ) : filteredAndSortedProjects.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  data-testid="list-lens-empty"
                  className="py-8 text-center text-xs text-[var(--nx-text-muted)]"
                >
                  未找到匹配的项目
                </td>
              </tr>
            ) : (
              filteredAndSortedProjects.map((project, index) => {
                const isFocused = index === focusedIndex
                const formattedDate = project.updatedAt
                  ? project.updatedAt.slice(0, 10)
                  : project.createdAt
                    ? project.createdAt.slice(0, 10)
                    : '-'

                return (
                  <tr
                    key={project.id}
                    data-project-row=""
                    data-project-id={project.id}
                    data-selected={isFocused}
                    tabIndex={-1}
                    onClick={() => handleSelect(project)}
                    className={`h-[36px] [[data-immersion='precise']_&]:h-[32px] cursor-pointer transition-colors select-none ${
                      isFocused
                        ? 'bg-[var(--nx-bg-2)] text-[var(--nx-text-primary)] ring-1 ring-inset ring-[var(--nx-border-focus)]'
                        : 'hover:bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]'
                    }`}
                  >
                    {/* 项目名称 + 图标 */}
                    <td className="px-3 py-1 font-medium text-[var(--nx-text-primary)] max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        <FolderGit2
                          className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
                          aria-hidden
                        />
                        <span className="truncate" title={project.name}>
                          {project.name}
                        </span>
                      </div>
                    </td>

                    {/* 项目标识代码 */}
                    <td className="px-3 py-1">
                      <CopyableCode
                        code={formatProjectCode(project)}
                        className="border-transparent px-0 py-0"
                      />
                    </td>

                    {/* 状态微标 */}
                    <td className="px-3 py-1">
                      <span
                        data-status-badge={project.status}
                        className="inline-flex items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] leading-none"
                      >
                        {STATUS_LABELS[project.status] ?? project.status}
                      </span>
                    </td>

                    {/* 优先级微标 */}
                    <td className="px-3 py-1">
                      <span
                        data-priority-badge={project.priority}
                        className={`text-[11px] font-medium ${
                          project.priority === 'critical'
                            ? 'text-[var(--nx-status-danger)]'
                            : project.priority === 'high'
                              ? 'text-[var(--nx-status-warning)]'
                              : project.priority === 'medium'
                                ? 'text-[var(--nx-status-info)]'
                                : 'text-[var(--nx-text-muted)]'
                        }`}
                      >
                        {PRIORITY_LABELS[project.priority] ?? project.priority}
                      </span>
                    </td>

                    {/* 拥有者 */}
                    <td className="px-3 py-1 truncate text-xs text-[var(--nx-text-muted)]">
                      {project.departmentName || `UID:${project.createdBy}`}
                    </td>

                    {/* 最后更新时间 */}
                    <td className="px-3 py-1 font-mono text-[11px] text-[var(--nx-text-muted)]">
                      {formattedDate}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--nx-text-muted)]">
        <span>共 {filteredAndSortedProjects.length} 个项目</span>
        <div className="flex items-center gap-3">
          <span>
            <kbd className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1 font-mono text-[10px]">
              ↑
            </kbd>
            <kbd className="ml-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1 font-mono text-[10px]">
              ↓
            </kbd>{' '}
            行间漫游
          </span>
          <span>
            <kbd className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1 font-mono text-[10px]">
              Enter
            </kbd>{' '}
            直达项目空间
          </span>
        </div>
      </div>
    </div>
  )
}
