'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  Cpu,
  FolderTree,
  Layers,
  Package,
  RotateCcw,
  Search,
  SearchX,
  ShieldAlert,
  Users,
  Wallet,
} from 'lucide-react'
import { resourcesApi, type PaginatedResources } from '@/lib/api/resources'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import {
  buildRbsTree,
  collectAllNodeKeys,
  collectSkillMatchIds,
  formatRbsHours,
  formatRbsPersonDays,
  RBS_STATUS_LABELS,
  type RbsCategoryNode,
  type RbsInstanceNode,
  type RbsNode,
  type RbsResourceInput,
  type RbsRoleNode,
  type RbsRootNode,
} from '@/lib/next/charts/rbs-aggregator'

/**
 * RBS 资源分解结构树状分级镜头（v3-ui-next-chart-gallery tasks 4.5 / spec
 * 「资源分解结构 RBS 树状分级渲染」）。
 *
 * - 数据：GET /projects/:projectId/resources（resourcesApi.list，分页遍历全量）；
 * - 视图：四级树（项目资源总库 → 资源大类 → 角色工种 → 资源实例），支持一键
 *   全部展开/折叠、分类度量徽章（资源数 · 容量工时 · 人天卷算）；
 * - 技能检索：输入关键词即时高亮匹配人员节点、半透明弱化其余节点；
 *   检索期间自动全量展开，清空后恢复用户手动展开态；
 * - RBAC：resource:view 门禁（无权限零数据请求，W5 断言点）；
 * - 只读铁律：全部交互（展开/折叠/检索）零写请求，仅 GET（RL-01）。
 */
export interface RbsTreeChartLensProps {
  projectId: number
}

const PAGE_SIZE = 100

/** 分页遍历拉取项目资源全量清单（perPage 服务端上限 100）。 */
async function fetchAllResources(projectId: number): Promise<RbsResourceInput[]> {
  const all: RbsResourceInput[] = []
  let page = 1
  for (;;) {
    const res: PaginatedResources = await resourcesApi.list(projectId, {
      page,
      perPage: PAGE_SIZE,
    })
    all.push(...(res.data ?? []))
    const totalPages = res.meta?.totalPages ?? 1
    if (page >= totalPages || totalPages <= 0) break
    page += 1
  }
  return all
}

export const rbsLensQueryKey = (projectId: number) => ['resources', 'lens-rbs', projectId] as const

function instanceIcon(resourceType: string): React.ComponentType<{ className?: string }> {
  if (resourceType === 'human') return Users
  if (resourceType === 'equipment') return Cpu
  if (resourceType === 'budget') return Wallet
  return Package
}

export function RbsTreeChartLens({ projectId }: RbsTreeChartLensProps) {
  const { can } = usePermissions()
  const {
    data: rawResources,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: rbsLensQueryKey(projectId),
    queryFn: () => fetchAllResources(projectId),
    enabled: can('resource:view') && projectId > 0,
  })

  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())
  const [keyword, setKeyword] = React.useState('')

  const resources = rawResources ?? []
  const tree = React.useMemo(() => buildRbsTree(resources), [resources])
  const allNodeKeys = React.useMemo(() => new Set(collectAllNodeKeys(tree)), [tree])
  const defaultKeys = React.useMemo(() => {
    const keys = new Set<string>(['root'])
    for (const category of tree.children) keys.add(category.key)
    return keys
  }, [tree])

  // 默认展开态：根 + 全部资源大类（L3 角色折叠）。数据到达后仅首次应用。
  const initialized = React.useRef(false)
  React.useEffect(() => {
    if (!initialized.current && !isLoading && rawResources !== undefined) {
      initialized.current = true
      setExpandedKeys(defaultKeys)
    }
  }, [isLoading, rawResources, defaultKeys])

  const trimmedKeyword = keyword.trim().toLowerCase()
  const searching = trimmedKeyword !== ''
  const matchedIds = React.useMemo(
    () => collectSkillMatchIds(tree, trimmedKeyword),
    [tree, trimmedKeyword],
  )

  const hasMatchByKey = React.useMemo(() => {
    const map = new Map<string, boolean>()
    if (!searching) return map
    const walkCategory = (category: RbsCategoryNode) => {
      let matched = false
      for (const role of category.children) {
        const roleMatched = role.children.some((item) => matchedIds.has(item.resourceId))
        map.set(role.key, roleMatched)
        matched = matched || roleMatched
      }
      map.set(category.key, matched)
    }
    for (const category of tree.children) walkCategory(category)
    return map
  }, [tree, searching, matchedIds])

  // 检索期间强制全量展开（命中项可直达可见），清空后恢复用户展开态
  const isExpanded = (node: RbsNode) =>
    searching ? true : node.kind !== 'instance' && expandedKeys.has(node.key)
  const isDimmed = (node: RbsNode) => {
    if (!searching) return false
    if (node.kind === 'instance') return !matchedIds.has(node.resourceId)
    return hasMatchByKey.get(node.key) !== true
  }

  const toggleNode = (node: RbsNode) => {
    if (searching || node.kind === 'instance') return
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(node.key)) next.delete(node.key)
      else next.add(node.key)
      return next
    })
  }

  if (!can('resource:view')) {
    return (
      <div
        data-rbs-lens
        data-rbs-view-fallback
        className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-12 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
          你没有查看该项目资源分解的权限
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          资源分解结构 RBS 需要 resource:view 权限，请联系组织管理员或项目负责人授权。
        </p>
      </div>
    )
  }

  return (
    <div data-rbs-lens className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* 头部：标题 + 卷算汇总 */}
      <section
        data-rbs-summary
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Layers className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
              资源分解结构 RBS
            </h3>
            <p className="font-mono text-[10px] text-[var(--nx-text-muted)]">
              L1 总库 → L2 大类 → L3 角色 → L4 实例
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span
            data-rbs-summary-count
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 text-[var(--nx-text-secondary)]"
          >
            {tree.resourceCount} 项资源
          </span>
          <span
            data-rbs-summary-hours
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 text-[var(--nx-text-secondary)]"
          >
            {formatRbsHours(tree.capacityHoursPerDay)}
          </span>
          <span
            data-rbs-summary-person-days
            className="rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2 py-1 text-[var(--nx-accent)]"
          >
            {formatRbsPersonDays(tree.capacityPersonDays)}
          </span>
        </div>
      </section>

      {/* 工具条：展开/折叠 + 技能检索 */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-rbs-expand-all
            onClick={() => setExpandedKeys(new Set(allNodeKeys))}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            全部展开
          </button>
          <button
            type="button"
            data-rbs-collapse-all
            onClick={() => setExpandedKeys(new Set())}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            全部折叠
          </button>
        </div>
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            role="searchbox"
            aria-label="按技能标签搜索资源"
            data-rbs-skill-search
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="输入技能关键词检索（如 React）…"
            className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] pl-8 pr-8 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
          />
          {keyword !== '' ? (
            <button
              type="button"
              data-rbs-skill-search-clear
              aria-label="清除技能搜索"
              onClick={() => setKeyword('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
            >
              <SearchX className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </section>

      {searching ? (
        <p data-rbs-search-status className="text-[11px] text-[var(--nx-text-muted)]">
          检索技能关键词「{keyword.trim()}」：命中 {matchedIds.size} 项资源，
          <span className="text-[var(--nx-accent)]">匹配项高亮</span>，其余节点半透明弱化。
        </p>
      ) : null}

      {/* 三态：加载 / 错误 / 空态 / 树 */}
      <section
        data-rbs-tree
        aria-busy={isLoading || isFetching}
        className="overflow-x-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-2"
      >
        {isLoading && rawResources === undefined ? (
          <div data-rbs-skeleton aria-label="资源树加载中" className="space-y-1.5 p-2">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-sm bg-[var(--nx-bg-1)]"
                aria-hidden
              />
            ))}
          </div>
        ) : isError ? (
          <div
            role="alert"
            aria-label="资源分解结构加载错误"
            className="flex flex-col items-center gap-3 px-6 py-10 text-center"
          >
            <p className="text-sm text-[var(--nx-text-secondary)]">
              资源分解结构加载失败，请稍后重试
            </p>
            <button
              type="button"
              data-rbs-retry
              onClick={() => void refetch()}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              重新加载
            </button>
          </div>
        ) : tree.resourceCount === 0 ? (
          <div data-rbs-empty className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <FolderTree className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
            <p className="text-sm text-[var(--nx-text-secondary)]">当前项目尚未配置资源</p>
            <p className="text-[11px] text-[var(--nx-text-muted)]">
              前往资源管理为项目登记人员 / 设备 / 物料后，本镜头将自动聚合四级分解结构。
            </p>
          </div>
        ) : (
          <div role="tree" aria-label="资源分解结构树" className="min-w-max py-1">
            <RbsRow
              node={tree}
              depth={0}
              lensState={{
                expandedKeys,
                searching,
                keyword: trimmedKeyword,
                matchedIds,
                isExpanded,
                isDimmed,
                onToggle: toggleNode,
              }}
            />
          </div>
        )}
      </section>
    </div>
  )
}

interface RbsLensState {
  expandedKeys: Set<string>
  searching: boolean
  keyword: string
  matchedIds: Set<number>
  isExpanded: (node: RbsNode) => boolean
  isDimmed: (node: RbsNode) => boolean
  onToggle: (node: RbsNode) => void
}

/** 单行渲染（叶节点为实例行；父节点递归渲染子行）。 */
function RbsRow({
  node,
  depth,
  lensState,
}: {
  node: RbsNode
  depth: number
  lensState: RbsLensState
}) {
  const { searching, isExpanded, isDimmed, onToggle } = lensState
  const expanded = node.kind === 'instance' ? false : isExpanded(node)
  const dimmed = isDimmed(node)
  const indent = { paddingLeft: `${8 + depth * 22}px` }

  return (
    <div data-rbs-node-group>
      {node.kind === 'instance' ? (
        <RbsInstanceRow node={node} dimmed={dimmed} indent={indent} lensState={lensState} />
      ) : (
        <>
          <RbsBranchRow
            node={node}
            expanded={expanded}
            dimmed={dimmed}
            searching={searching}
            onToggle={onToggle}
            indent={indent}
          />
          {expanded
            ? node.children.map((child) => (
                <RbsRow key={child.key} node={child} depth={depth + 1} lensState={lensState} />
              ))
            : null}
        </>
      )}
    </div>
  )
}

function branchIcon(node: RbsRootNode | RbsCategoryNode | RbsRoleNode) {
  if (node.kind === 'root') return Layers
  return instanceIcon(node.resourceType)
}

function MetricChip({
  count,
  hours,
  personDays,
  compact = false,
}: {
  count: number
  hours: number
  personDays: number
  compact?: boolean
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-[var(--nx-text-muted)]">
      <span className="rounded-sm bg-[var(--nx-bg-1)] px-1.5 py-0.5">{count} 项</span>
      {!compact ? (
        <span className="rounded-sm bg-[var(--nx-bg-1)] px-1.5 py-0.5">
          {formatRbsHours(hours)}
        </span>
      ) : null}
      <span className="rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-1.5 py-0.5 text-[var(--nx-accent)]">
        {formatRbsPersonDays(personDays)}
      </span>
    </span>
  )
}

interface BranchRowProps {
  node: RbsRootNode | RbsCategoryNode | RbsRoleNode
  expanded: boolean
  dimmed: boolean
  searching: boolean
  indent: { paddingLeft: string }
  onToggle: (node: RbsNode) => void
}

function RbsBranchRow({ node, expanded, dimmed, searching, indent, onToggle }: BranchRowProps) {
  const Icon = branchIcon(node)
  return (
    <div
      data-rbs-node
      data-rbs-node-level={node.level}
      data-rbs-node-key={node.key}
      data-rbs-dimmed={dimmed || undefined}
      data-rbs-search-context={searching && node.level === 1 ? 'true' : undefined}
      style={indent}
      className={cn(
        'flex items-center gap-2 rounded-sm py-1.5 pr-3 transition-opacity',
        dimmed && 'opacity-25',
      )}
    >
      <button
        type="button"
        data-rbs-toggle
        aria-label={`${expanded ? '折叠' : '展开'} ${node.label}`}
        aria-expanded={expanded}
        disabled={searching}
        onClick={() => onToggle(node)}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-accent)] disabled:opacity-40',
          !searching && 'hover:bg-[var(--nx-bg-1)]',
        )}
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
          aria-hidden
        />
      </button>
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          node.kind === 'root' ? 'text-[var(--nx-accent)]' : 'text-[var(--nx-text-muted)]',
        )}
        aria-hidden
      />
      <span
        className={cn(
          'min-w-0 truncate text-[13px]',
          node.kind === 'root'
            ? 'font-semibold text-[var(--nx-text-primary)]'
            : node.level === 2
              ? 'font-medium text-[var(--nx-text-primary)]'
              : 'text-[var(--nx-text-secondary)]',
        )}
      >
        {node.label}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <MetricChip
          count={node.resourceCount}
          hours={node.capacityHoursPerDay}
          personDays={node.capacityPersonDays}
          compact={node.kind === 'role'}
        />
      </div>
    </div>
  )
}

function RbsInstanceRow({
  node,
  dimmed,
  indent,
  lensState,
}: {
  node: RbsInstanceNode
  dimmed: boolean
  indent: { paddingLeft: string }
  lensState: RbsLensState
}) {
  const { searching, matchedIds } = lensState
  const matched = searching && matchedIds.has(node.resourceId)
  const Icon = instanceIcon(node.resourceType)
  const statusLabel = RBS_STATUS_LABELS[node.status] ?? node.status
  const active = node.status === 'active'
  const kw = searching ? lensState.keyword : ''

  return (
    <div
      data-rbs-node
      data-rbs-node-level={4}
      data-rbs-node-key={node.key}
      data-rbs-search-match={matched || undefined}
      data-rbs-dimmed={dimmed || undefined}
      style={indent}
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm py-1.5 pr-3 transition-opacity',
        dimmed && 'opacity-25',
        matched && 'border-l-2 border-l-[var(--nx-accent)] bg-[var(--nx-space-surface)]',
      )}
    >
      <span className="w-6 shrink-0" aria-hidden />
      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs text-[var(--nx-text-primary)]">{node.name}</span>
        {node.email ? (
          <span className="truncate font-mono text-[9px] text-[var(--nx-text-muted)]">
            {node.email}
          </span>
        ) : null}
      </div>
      <span
        data-rbs-status
        className={cn(
          'rounded-sm border px-1.5 py-0.5 text-[9px]',
          active
            ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)]'
            : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
        )}
      >
        {statusLabel}
      </span>
      {node.skillTags.length > 0 ? (
        <span className="flex flex-wrap items-center gap-1">
          {node.skillTags.map((skill) => {
            const hit = kw && skill.toLowerCase().includes(kw)
            return (
              <span
                key={skill}
                data-rbs-skill={skill}
                data-rbs-skill-hit={hit ? 'true' : undefined}
                className={cn(
                  'rounded-sm border px-1.5 py-0.5 font-mono text-[9px]',
                  hit
                    ? 'border-[var(--nx-accent)] bg-[rgba(56,189,248,0.14)] text-[var(--nx-accent)]'
                    : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
                )}
              >
                {skill}
              </span>
            )
          })}
        </span>
      ) : null}
      <span
        data-rbs-capacity
        className="ml-auto shrink-0 font-mono text-[10px] text-[var(--nx-text-secondary)]"
      >
        {formatRbsHours(node.capacityHoursPerDay)}
      </span>
    </div>
  )
}

export default RbsTreeChartLens
