'use client'

import { CopyableCode } from '@/components/next/common/CopyableCode'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  FolderGit2,
  CheckSquare,
  Users,
  FileText,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  GitPullRequest,
  Flag,
  BarChart3,
  MoreHorizontal,
} from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { searchApi } from '@/lib/api/search'
import type { SearchResultItem } from '@aiproj/types'

export type GlobalSearchCategory =
  | 'project'
  | 'task'
  | 'member'
  | 'file'
  | 'risk'
  | 'change_request'
  | 'milestone'
  | 'report'
  | 'other'

export interface SpaceMapGlobalSearchLensProps {
  /** 外部传入检索词（与外层输入框受控同步） */
  query?: string
  /** 检索词变更通知 */
  onQueryChange?: (q: string) => void
  /** 是否渲染内置搜索输入框（单测或独立展示时为 true，嵌入 SpaceMapOverlay 已有输入框时设为 false） */
  showInput?: boolean
  /** 外部显式传入的结果列表（用于单元测试或外部缓存灌入） */
  results?: SearchResultItem[]
  /** 选中结果回调（未提供则默认跳转对应新轨深链路由并关闭浮层） */
  onSelectResult?: (item: SearchResultItem) => void
  /** 关闭浮层回调 */
  onClose?: () => void
  /** 初始聚焦索引 */
  initialFocusedIndex?: number
  /** 自定义容器类名 */
  className?: string
  /** 输入框占位文案 */
  placeholder?: string
}

export const CATEGORY_ORDER: readonly GlobalSearchCategory[] = [
  'project',
  'task',
  'member',
  'file',
  'risk',
  'change_request',
  'milestone',
  'report',
  'other',
]

export const CATEGORY_META: Record<
  GlobalSearchCategory,
  { label: string; icon: React.ComponentType<{ className?: string }>; badgeLabel: string }
> = {
  project: { label: '项目', icon: FolderGit2, badgeLabel: '项目' },
  task: { label: '任务', icon: CheckSquare, badgeLabel: '任务' },
  member: { label: '成员', icon: Users, badgeLabel: '成员' },
  file: { label: '文件', icon: FileText, badgeLabel: '文件' },
  risk: { label: '风险', icon: AlertTriangle, badgeLabel: '风险' },
  change_request: { label: '变更请求', icon: GitPullRequest, badgeLabel: '变更' },
  milestone: { label: '里程碑', icon: Flag, badgeLabel: '里程碑' },
  report: { label: '报告', icon: BarChart3, badgeLabel: '报告' },
  other: { label: '其它', icon: MoreHorizontal, badgeLabel: '其它' },
}

/**
 * 将后端 entityType 归一化为分组。原先除项目 / 任务 / 成员外一律归为「文件」：
 * 风险、变更等被显示成文件，点进去是 404（实测）。
 */
export function resolveCategory(entityType: string): GlobalSearchCategory {
  const t = entityType.toLowerCase()
  if (t === 'project') return 'project'
  if (t === 'task') return 'task'
  if (t === 'member' || t === 'user') return 'member'
  if (t === 'file' || t === 'document') return 'file'
  if (t === 'risk') return 'risk'
  if (t === 'change_request') return 'change_request'
  if (t === 'milestone') return 'milestone'
  if (t === 'report') return 'report'
  return 'other'
}

function projectIdOf(item: SearchResultItem): number | null {
  if (item.projectId) return item.projectId
  const match = item.target ? /projects\/(\d+)/.exec(item.target) : null
  return match?.[1] ? Number(match[1]) : null
}

/** 派生目标深链路由 */
export function resolveEntityDirectUrl(item: SearchResultItem): string {
  const category = resolveCategory(item.entityType)
  // 后端 target 是旧版路径（/projects/6/risks/12 等），新版没有对应页面；只认 /next 开头的。
  if (item.target?.startsWith('/next')) return item.target
  const projectId = projectIdOf(item)
  const base = projectId ? `/next/projects/${projectId}` : '/next/projects'
  switch (category) {
    case 'project':
      return `/next/projects/${item.projectId ?? item.entityId}`
    case 'task':
      return projectId ? `${base}?focusTask=${item.entityId}` : '/next/projects'
    case 'member':
      return '/next/resources'
    case 'file':
      return projectId ? `${base}/files?focusFile=${item.entityId}` : '/next/projects'
    case 'risk':
      return projectId ? `${base}/risks?focusRisk=${item.entityId}` : '/next/projects'
    case 'change_request':
      return projectId ? `${base}/change-requests/${item.entityId}` : '/next/projects'
    case 'milestone':
      return projectId ? `${base}?lens=gantt` : '/next/projects'
    case 'report':
      return projectId ? `${base}/reports` : '/next/projects'
    default:
      return base
  }
}

/**
 * 空间地图全域跨实体检索组件（v3-ui-next-batch3-global-convergence W1 · tasks 1.1）。
 *
 * 核心契约（design Decision 1 & spec「空间地图全域跨实体检索与高密度分类呈现规范」）：
 * - 36px（精确档 32px）发丝线高密度行，暗黑仪器风底色，零大面积留白；
 * - 结构化四分类分组：项目、任务、成员、文件；
 * - 默认每组展示 Top 5 项，组头展示匹配总数并支持「展开全部」；
 * - 300ms 防抖查询，微型扫描指示器；
 * - 键盘 ArrowUp / ArrowDown 跨组连续焦点移动与 Enter 直达；
 * - 任务项直达携带 `?focusTask=:taskId` 并唤起关闭；
 * - `data-immersion="precise"` 纯平降级与 prefers-reduced-motion 支持。
 */
export function SpaceMapGlobalSearchLens({
  query: propQuery,
  onQueryChange,
  showInput = true,
  results: propResults,
  onSelectResult,
  onClose,
  initialFocusedIndex = 0,
  className = '',
  placeholder = '搜索项目、任务、成员或文件…',
}: SpaceMapGlobalSearchLensProps) {
  const router = useRouter()
  const immersionTier = useImmersionTier()
  const isPrecise = immersionTier === 'precise'

  // 输入词状态：支持受控与非受控
  const [internalInput, setInternalInput] = React.useState(propQuery ?? '')
  const [debouncedQuery, setDebouncedQuery] = React.useState(propQuery ?? '')
  const [isSearching, setIsSearching] = React.useState(false)
  const [apiResults, setApiResults] = React.useState<SearchResultItem[]>([])
  const [focusedIndex, setFocusedIndex] = React.useState(initialFocusedIndex)
  const [expandedCategories, setExpandedCategories] = React.useState<
    Record<GlobalSearchCategory, boolean>
  >({
    project: false,
    task: false,
    member: false,
    file: false,
    risk: false,
    change_request: false,
    milestone: false,
    report: false,
    other: false,
  })

  // 同步 propQuery
  React.useEffect(() => {
    if (propQuery !== undefined) {
      setInternalInput(propQuery)
    }
  }, [propQuery])

  // 300ms 防抖更新 debouncedQuery
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(internalInput.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [internalInput])

  // 处理 API 异步检索
  React.useEffect(() => {
    if (propResults !== undefined) {
      // 外部传入结果集时直接使用，无需网络请求
      return
    }

    if (!debouncedQuery) {
      setApiResults([])
      setIsSearching(false)
      return
    }

    let isSubscribed = true
    setIsSearching(true)

    searchApi
      .search({ keyword: debouncedQuery, perPage: 40 })
      .then((res) => {
        if (!isSubscribed) return
        const list = Array.isArray(res?.data)
          ? res.data
          : Array.isArray((res as unknown as { data?: { data?: SearchResultItem[] } })?.data?.data)
            ? (res as unknown as { data: { data: SearchResultItem[] } }).data.data
            : []
        setApiResults(list)
      })
      .catch(() => {
        if (isSubscribed) setApiResults([])
      })
      .finally(() => {
        if (isSubscribed) setIsSearching(false)
      })

    return () => {
      isSubscribed = false
    }
  }, [debouncedQuery, propResults])

  // 输入还在防抖、或请求还没回来：不能先显示「未找到」（实测先闪「没有」再出结果）
  const pending =
    propResults === undefined &&
    internalInput.trim() !== '' &&
    (internalInput.trim() !== debouncedQuery || isSearching)

  // 最终数据集：优先 propResults（过滤后），其次 apiResults
  const effectiveResults = React.useMemo(() => {
    if (propResults !== undefined) {
      if (!debouncedQuery) return propResults
      const q = debouncedQuery.toLowerCase()
      return propResults.filter(
        (item) =>
          item.title?.toLowerCase().includes(q) ||
          item.summary?.toLowerCase().includes(q) ||
          (item.metadata?.code && String(item.metadata.code).toLowerCase().includes(q)) ||
          (item.metadata?.projectName &&
            String(item.metadata.projectName).toLowerCase().includes(q)) ||
          (item.metadata?.email && String(item.metadata.email).toLowerCase().includes(q)),
      )
    }
    return apiResults
  }, [propResults, debouncedQuery, apiResults])

  // 分组聚合
  const groupedResults = React.useMemo(() => {
    const groups: Record<GlobalSearchCategory, SearchResultItem[]> = {
      project: [],
      task: [],
      member: [],
      file: [],
      risk: [],
      change_request: [],
      milestone: [],
      report: [],
      other: [],
    }
    for (const item of effectiveResults) {
      const cat = resolveCategory(item.entityType)
      groups[cat].push(item)
    }
    return groups
  }, [effectiveResults])

  // 展开状态下的扁平化可见条目（供键盘导航索引）
  const flatVisibleItems = React.useMemo(() => {
    const flat: { item: SearchResultItem; category: GlobalSearchCategory }[] = []
    for (const cat of CATEGORY_ORDER) {
      const items = groupedResults[cat]
      if (!items || items.length === 0) continue
      const isExpanded = expandedCategories[cat]
      const visibleItems = isExpanded ? items : items.slice(0, 5)
      for (const item of visibleItems) {
        flat.push({ item, category: cat })
      }
    }
    return flat
  }, [groupedResults, expandedCategories])

  // 当结果项变更时重置焦点至第一项
  React.useEffect(() => {
    setFocusedIndex(0)
  }, [flatVisibleItems.length])

  // 激活直达项
  const handleItemClick = React.useCallback(
    (item: SearchResultItem) => {
      onClose?.()
      if (onSelectResult) {
        onSelectResult(item)
      } else {
        const directUrl = resolveEntityDirectUrl(item)
        router.push(directUrl)
      }
    },
    [onClose, onSelectResult, router],
  )

  // 键盘快捷键监听
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (flatVisibleItems.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setFocusedIndex((prev) => (prev + 1) % flatVisibleItems.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setFocusedIndex((prev) => (prev - 1 + flatVisibleItems.length) % flatVisibleItems.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = flatVisibleItems[focusedIndex]
      if (target) {
        handleItemClick(target.item)
      }
    }
  }

  const toggleCategoryExpand = (cat: GlobalSearchCategory) => {
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  let cumulativeIndex = 0

  return (
    <div
      data-space-map-global-search-lens=""
      data-immersion={isPrecise ? 'precise' : immersionTier}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`flex flex-col gap-3 outline-none ${className}`}
    >
      {/* 搜索输入框 */}
      {showInput && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--nx-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            value={internalInput}
            onChange={(e) => {
              const val = e.target.value
              setInternalInput(val)
              onQueryChange?.(val)
            }}
            aria-label="全域跨实体检索"
            placeholder={placeholder}
            className={`h-10 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] pl-9 pr-8 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] ${
              isPrecise ? 'bg-black border-neutral-800' : ''
            }`}
          />
          {/* 微型扫描指示动画 */}
          {isSearching && (
            <div
              data-testid="search-scanner"
              role="status"
              aria-label="正在扫描全域实体"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--nx-space-cyan)]"
            >
              <div
                className={`h-2.5 w-2.5 rounded-full border-2 border-[var(--nx-space-cyan)] border-t-transparent ${
                  isPrecise ? '' : 'animate-spin'
                }`}
              />
            </div>
          )}
        </div>
      )}

      {/* 结果渲染区域 */}
      <div
        data-testid="search-results-container"
        className="max-h-[60vh] space-y-4 overflow-y-auto pr-1"
      >
        {flatVisibleItems.length === 0 && pending ? (
          <div
            data-testid="search-pending-state"
            role="status"
            className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--nx-text-secondary)]"
          >
            <Search className="h-4 w-4 animate-pulse text-[var(--nx-text-muted)]" aria-hidden />
            正在搜索「{internalInput.trim()}」…
          </div>
        ) : flatVisibleItems.length === 0 ? (
          <div
            data-testid="search-empty-state"
            role="status"
            className="flex flex-col items-center justify-center gap-2 py-8 text-center"
          >
            <Search className="h-5 w-5 text-[var(--nx-text-muted)]" aria-hidden />
            <p className="text-sm text-[var(--nx-text-secondary)]">未找到匹配的跨实体结果</p>
            <p className="text-xs text-[var(--nx-text-muted)]">
              可尝试关键词如「支付」「鉴权」「架构」「验收」
            </p>
          </div>
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const items = groupedResults[cat]
            if (!items || items.length === 0) return null

            const { label, icon: Icon, badgeLabel } = CATEGORY_META[cat]
            const isExpanded = expandedCategories[cat]
            const visibleItems = isExpanded ? items : items.slice(0, 5)
            const hasMore = items.length > 5

            return (
              <section
                key={cat}
                data-category-section={cat}
                aria-label={`${label}结果分组`}
                className="space-y-1.5"
              >
                {/* 组头：实体类别与匹配总数 */}
                <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] pb-1 px-1 text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-[var(--nx-text-secondary)]">
                    <Icon className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
                    <span>{label}</span>
                    <span
                      data-testid={`badge-count-${cat}`}
                      className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--nx-text-muted)]"
                    >
                      {items.length} 条
                    </span>
                  </div>

                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => toggleCategoryExpand(cat)}
                      className="flex items-center gap-0.5 text-[11px] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] transition-colors"
                    >
                      <span>{isExpanded ? '收起' : '展开全部'}</span>
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>

                {/* 实体行列表：单行高 36px / 精确档 32px */}
                <div className="space-y-1" role="listbox">
                  {visibleItems.map((item) => {
                    const currentIndex = cumulativeIndex
                    cumulativeIndex += 1
                    const isFocused = currentIndex === focusedIndex

                    return (
                      <div
                        key={`${item.entityType}-${item.entityId}`}
                        role="option"
                        aria-selected={isFocused}
                        data-search-row=""
                        data-entity-type={item.entityType}
                        data-entity-id={item.entityId}
                        data-focused={isFocused ? 'true' : 'false'}
                        data-immersion={isPrecise ? 'precise' : immersionTier}
                        onClick={() => handleItemClick(item)}
                        style={{
                          height: isPrecise ? '32px' : '36px',
                          minHeight: isPrecise ? '32px' : '36px',
                        }}
                        className={`group flex items-center justify-between gap-3 px-2.5 rounded border transition-colors cursor-pointer text-xs ${
                          isFocused
                            ? 'border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] shadow-sm'
                            : 'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] hover:bg-[var(--nx-bg-1)] hover:border-[var(--nx-border-focus)]/60'
                        } ${isPrecise ? 'bg-black border-neutral-800' : ''}`}
                      >
                        {/* 左侧：徽标与标题 */}
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            data-testid="entity-type-badge"
                            className="shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 py-0.5 font-mono text-[10px] text-[var(--nx-text-secondary)]"
                          >
                            {badgeLabel}
                          </span>
                          <span
                            data-testid="entity-title"
                            className="truncate font-medium text-[var(--nx-text-primary)]"
                          >
                            {item.title}
                          </span>
                        </div>

                        {/* 右侧：结构化属性高密度呈现 */}
                        <div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--nx-text-muted)]">
                          {cat === 'project' && (
                            <>
                              {Boolean(item.metadata?.code) && (
                                <CopyableCode
                                  code={String(item.metadata?.code)}
                                  className="px-1 py-0 text-[10px]"
                                />
                              )}
                              {Boolean(item.status || item.metadata?.status) && (
                                <span className="rounded bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px]">
                                  {String(item.status || item.metadata?.status)}
                                </span>
                              )}
                              {Boolean(item.metadata?.healthStatus) && (
                                <span
                                  data-testid="health-status"
                                  className="text-[10px] text-[var(--nx-status-success)]"
                                >
                                  {String(item.metadata?.healthStatus)}
                                </span>
                              )}
                            </>
                          )}

                          {cat === 'task' && (
                            <>
                              {Boolean(item.metadata?.code) && (
                                <CopyableCode
                                  code={String(item.metadata?.code)}
                                  className="px-1 py-0 text-[10px]"
                                />
                              )}
                              {Boolean(item.metadata?.projectName || item.projectId) && (
                                <span className="rounded bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
                                  {String(item.metadata?.projectName ?? `项目 #${item.projectId}`)}
                                </span>
                              )}
                              {Boolean(item.status || item.metadata?.status) && (
                                <span className="rounded bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px]">
                                  {String(item.status || item.metadata?.status)}
                                </span>
                              )}
                              {Boolean(
                                item.metadata?.dueDate || item.metadata?.endDate || item.updatedAt,
                              ) && (
                                <span className="font-mono text-[10px]">
                                  {String(
                                    item.metadata?.dueDate ||
                                      item.metadata?.endDate ||
                                      item.updatedAt?.slice(0, 10),
                                  )}
                                </span>
                              )}
                            </>
                          )}

                          {cat === 'member' && (
                            <>
                              {Boolean(item.metadata?.role || item.metadata?.roleName) && (
                                <span className="rounded bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-space-cyan)]">
                                  {String(item.metadata?.role || item.metadata?.roleName)}
                                </span>
                              )}
                              {Boolean(
                                item.metadata?.department || item.metadata?.email || item.summary,
                              ) && (
                                <span className="truncate max-w-[120px] text-[10px]">
                                  {String(
                                    item.metadata?.department ||
                                      item.metadata?.email ||
                                      item.summary,
                                  )}
                                </span>
                              )}
                            </>
                          )}

                          {cat === 'file' && (
                            <>
                              {Boolean(
                                item.metadata?.extension ||
                                item.metadata?.fileType ||
                                item.title.includes('.'),
                              ) && (
                                <span className="font-mono text-[10px] text-[var(--nx-accent)]">
                                  {String(
                                    item.metadata?.extension ||
                                      item.metadata?.fileType ||
                                      item.title.split('.').pop()?.toUpperCase(),
                                  )}
                                </span>
                              )}
                              {Boolean(item.metadata?.projectName || item.projectId) && (
                                <span className="text-[10px]">
                                  {String(item.metadata?.projectName ?? `项目 #${item.projectId}`)}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

export default SpaceMapGlobalSearchLens
