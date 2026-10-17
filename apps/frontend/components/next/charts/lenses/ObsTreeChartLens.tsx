/**
 * 组织分解结构 OBS 镜头组件（v3-chart-gallery-tier2-org-contract-plans W2 · task 2.1）。
 *
 * 契约与硬边界：
 * 1. Props 严格限定为 `{ projectId: number }`（对齐 `ChartLensComponentProps`）；
 * 2. 消费 `projectMetricsApi.obsTree`（只读 GET，RL-01 零写库）；
 * 3. 严格收敛复用 `lens-state-cards.tsx` 三态；
 * 4. 呈现形式适配数据本质（硬边界 8）：树形分级展开/折叠与缩进排版；
 * 5. 顶层提供一键展开/折叠与即时检索栏（标示 `data-export-ignore="true"`）；
 * 6. 视口插槽解耦：根容器挂载 `data-chart-lens-root="obs"`，主树形可视区挂载 `data-chart-viewport-slot`；
 * 7. 外部统一注入工具条与导出菜单，镜头内部绝不重复实现汇出按钮；
 * 8. 客观中性原则：DOM 零情绪化措辞。
 */
'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Search,
  SearchX,
  Users,
} from 'lucide-react'
import { projectMetricsApi, projectMetricsKeys } from '@/lib/api/project-metrics'
import {
  buildObsTreeViewModel,
  collectMatchingNodeKeys,
  filterObsTreeByKeyword,
  type ObsNodeViewModel,
} from '@/lib/next/charts/obs-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface ObsTreeChartLensProps {
  projectId: number
}

function ObsNodeRow({
  node,
  expandedKeys,
  onToggleExpand,
  searchKeyword,
  matchedKeys,
}: {
  node: ObsNodeViewModel
  expandedKeys: Set<string>
  onToggleExpand: (key: string) => void
  searchKeyword: string
  matchedKeys: Set<string>
}) {
  const isExpanded = expandedKeys.has(node.key)
  const isQueryActive = Boolean(searchKeyword.trim())
  const isMatched = matchedKeys.has(node.key)

  return (
    <div key={node.key} className="flex flex-col">
      <div
        data-obs-node={node.id}
        className={cn(
          'group flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-3 py-2.5 transition-colors hover:bg-[var(--nx-workspace-surface)]/60',
          isQueryActive && isMatched && 'bg-[var(--nx-accent)]/5',
        )}
        style={{ paddingLeft: `${node.depth * 1.5 + 0.75}rem` }}
      >
        {/* 左侧：折叠展开图标 + 部门信息 */}
        <div className="flex min-w-0 items-center gap-2">
          {node.hasChildren ? (
            <button
              type="button"
              aria-label={isExpanded ? `折叠部门 ${node.name}` : `展开部门 ${node.name}`}
              onClick={() => onToggleExpand(node.key)}
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="h-5 w-5 flex items-center justify-center text-[var(--nx-border-hairline)]">
              •
            </span>
          )}

          <Building2 className="h-4 w-4 shrink-0 text-[var(--nx-accent)]" />

          <span
            className="truncate text-xs font-medium text-[var(--nx-text-primary)]"
            title={node.name}
          >
            {node.name}
          </span>

          {node.code ? (
            <span className="shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
              {node.code}
            </span>
          ) : null}

          <span className="shrink-0 text-[11px] text-[var(--nx-text-muted)]">
            ({node.leaderName})
          </span>
        </div>

        {/* 右侧：度量指标卡片胶囊 */}
        <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-[var(--nx-text-muted)]">
          <span title="活跃成员数" className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            <span>{node.metrics.memberCount} 人</span>
          </span>

          <span className="text-[var(--nx-border-hairline)]">|</span>

          <span title="部门任务进度">
            任务 {node.metrics.completedTaskCount}/{node.metrics.taskCount}
          </span>

          <span className="text-[var(--nx-border-hairline)]">|</span>

          <span
            title="自底向上卷算总工时"
            className="rounded bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[var(--nx-text-secondary)]"
          >
            {node.metrics.totalEstimatedHours}h
          </span>
        </div>
      </div>

      {/* 子节点递归渲染 */}
      {node.hasChildren && isExpanded ? (
        <div className="flex flex-col">
          {node.children.map((child) => (
            <ObsNodeRow
              key={child.key}
              node={child}
              expandedKeys={expandedKeys}
              onToggleExpand={onToggleExpand}
              searchKeyword={searchKeyword}
              matchedKeys={matchedKeys}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ObsTreeChartLens({ projectId }: ObsTreeChartLensProps) {
  const query = useQuery({
    queryKey: projectMetricsKeys.obsTree(projectId),
    queryFn: () => projectMetricsApi.obsTree(projectId),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const rawData = query.data
  const model = React.useMemo(() => buildObsTreeViewModel(rawData), [rawData])

  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())
  const [keyword, setKeyword] = React.useState('')

  // 初始加载或数据变更时，默认展开所有节点
  React.useEffect(() => {
    if (model.allNodeKeys.length > 0) {
      setExpandedKeys(new Set(model.allNodeKeys))
    }
  }, [model.allNodeKeys])

  const matchedKeys = React.useMemo(
    () => collectMatchingNodeKeys(model.rootNodes, keyword),
    [model.rootNodes, keyword],
  )

  const displayedNodes = React.useMemo(
    () => filterObsTreeByKeyword(model.rootNodes, keyword),
    [model.rootNodes, keyword],
  )

  // 搜索时自动展开匹配路径上的节点
  React.useEffect(() => {
    if (keyword.trim() && matchedKeys.size > 0) {
      setExpandedKeys((prev) => new Set([...prev, ...matchedKeys]))
    }
  }, [keyword, matchedKeys])

  const toggleExpand = React.useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleExpandAll = React.useCallback(() => {
    setExpandedKeys(new Set(model.allNodeKeys))
  }, [model.allNodeKeys])

  const handleCollapseAll = React.useCallback(() => {
    setExpandedKeys(new Set())
  }, [])

  const retry = React.useCallback(() => {
    void query.refetch()
  }, [query])

  const isLoading = query.isLoading
  const isError = query.isError && !rawData
  const hasData = !model.isEmpty

  return (
    <div data-chart-lens-root="obs" className="flex min-h-[460px] flex-col gap-3">
      {/* 顶部交互操作与汇总指标条 */}
      <div
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-2.5 text-xs"
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]" />
            <input
              type="search"
              role="searchbox"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索部门或代码"
              className="h-7 w-48 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] pl-8 pr-2.5 text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
            />
          </div>

          {/* 展开/收起全部 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleExpandAll}
              className="h-7 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-2.5 text-xs text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] transition-colors"
            >
              展开全部
            </button>
            <button
              type="button"
              onClick={handleCollapseAll}
              className="h-7 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-2.5 text-xs text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] transition-colors"
            >
              收起全部
            </button>
          </div>
        </div>

        {/* 顶部度量汇总 */}
        {hasData && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--nx-text-muted)]">
            <span>部门 {model.totalDepartments} 个</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span>成员 {model.totalMembers} 位</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span>任务 {model.totalTasks} 项</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span>完成 {model.totalCompletedTasks} 项</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span className="text-[var(--nx-accent)]">工时 {model.totalEstimatedHours}h</span>
          </div>
        )}
      </div>

      {/* 三态与主视口 */}
      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载组织分解结构 OBS" chartHeight={420} />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="组织分解结构加载失败"
          title="组织分解结构加载失败"
          description="无法获取当前项目的部门组织架构与工时数据，请稍后重试。"
          onRetry={retry}
        />
      ) : !hasData ? (
        <ChartLensEmptyState
          icon={FolderTree}
          title="暂无组织分解结构数据"
          description="当前项目尚未挂载部门组织架构或工时数据。"
          ariaLabel="组织分解结构为空"
        />
      ) : displayedNodes.length === 0 ? (
        <div
          data-chart-viewport-slot
          className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center text-xs text-[var(--nx-text-muted)]"
        >
          <SearchX className="h-6 w-6" />
          <span>未找到匹配「{keyword}」的部门节点</span>
        </div>
      ) : (
        /* 主树形视口容器：挂载 data-chart-viewport-slot */
        <div
          data-chart-viewport-slot
          className="relative max-h-[620px] overflow-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-inner"
        >
          <div className="flex flex-col divide-y divide-[var(--nx-border-hairline)]">
            {displayedNodes.map((node) => (
              <ObsNodeRow
                key={node.key}
                node={node}
                expandedKeys={expandedKeys}
                onToggleExpand={toggleExpand}
                searchKeyword={keyword}
                matchedKeys={matchedKeys}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default ObsTreeChartLens
