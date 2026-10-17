/**
 * 新轨 WBS 结构俯瞰镜头工作面（v3-ui-next-remaining-lenses W1 / spec「WBS 结构俯瞰镜头渲染与虚拟化」）。
 *
 * 核心架构职责：
 * 1. 数据取数：复用 `useWbsTree(projectId)`（TanStack Query `wbsKeys.tree` 缓存），
 *    载入平铺 `WbsNode[]` 大纲树；
 * 2. 纯函数适配：消费 `lib/next/lenses-wbs-adapter.ts` 的 `computeVisibleWbsRows`
 *    计算当前展开态可见行（折叠集为权威状态，初始尊重接口 `collapsed` 字段）；
 * 3. 深度树虚拟化：以 `@tanstack/react-virtual` 的 `useVirtualizer` 对可见行实施
 *    视口纵向裁剪（行高 40px / 精确档 32px，overscan 8），500+ 节点项目下
 *    活动 DOM 行数 ≤ 50；每行按 `depth * 20px` 递进缩进并绘制 1px 发丝垂直
 *    树干引导线与正交短横线（消费 `--nx-border-hairline`）；
 * 4. 工具栏：常驻「展开全部」（清空折叠集）与「折叠至 L2」
 *    （`buildCollapseToSecondLevelSet`，仅保留根与一级子工作包展开）；
 * 5. 沉浸阶梯：`useImmersionTier()` + `prefers-reduced-motion` 下切精确档
 *    纯色紧凑排版（行高压缩、停用过渡动效），信息与交互 100% 等价；
 * 6. 状态反馈：暗黑仪器感发丝脉冲骨架屏（`aria-busy`）、空态引导卡与
 *    错误重试卡片（`refetch` 原位恢复，严禁白屏崩溃）。
 *
 * 7. 任务行：工作包下的任务（tasks.wbs_node_id）作为子行列出，点任务或绑定任务的节点
 *    打开详情抽屉；`?focusTask=` 时自动展开祖先、滚动到该任务并高亮。
 *
 * 只读防线（RL-06）：展开/折叠仅作用于前端 `collapsedIds` 集合，
 * 全程零 POST/PATCH/DELETE 写请求；无内联输入框与就地编辑入口。
 */

'use client'

import * as React from 'react'
import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'
import { ChevronRight, Network, TriangleAlert } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useWbsTree } from '@/hooks/use-wbs-tree'
import { taskKeys, tasksApi, type TaskStatus } from '@/lib/api/tasks'
import {
  buildCollapseToSecondLevelSet,
  computeVisibleWbsRows,
  createInitialCollapsedSet,
  interleaveWbsTaskRows,
  wbsAncestorIds,
  type VisibleWbsRowItem,
  type WbsLensTask,
} from '@/lib/next/lenses-wbs-adapter'

export interface WorkspaceWbsLensProps {
  projectId: number
  className?: string
  /** 首屏渲染完成度量（性能预算断言测试消费）：可见树渲染耗时 + 活动行 DOM 数。 */
  onRenderComplete?: (metric: { durationMs: number; activeElements: number }) => void
  /** 点任务：打开任务详情（容器同步 ?focusTask=）。 */
  onOpenTask?: (taskId: number) => void
  /** 当前聚焦的任务：自动展开祖先、滚动到该行并高亮。 */
  focusTaskId?: number | null
}

/** 任务行最多取 20 页（每页 100）——足够覆盖单项目任务量，防止异常数据无限翻页。 */
const WBS_TASK_MAX_PAGES = 20

async function fetchAllProjectTasks(projectId: number): Promise<WbsLensTask[]> {
  const all: WbsLensTask[] = []
  for (let page = 1; page <= WBS_TASK_MAX_PAGES; page += 1) {
    const result = await tasksApi.list(projectId, { perPage: 100, page })
    for (const task of result.data) {
      all.push({
        id: task.id,
        name: task.name,
        status: task.status,
        startDate: task.startDate,
        endDate: task.endDate,
        wbsNodeId: task.wbsNodeId ?? null,
      })
    }
    if (page >= (result.meta?.totalPages ?? 1)) break
  }
  return all
}

/** 沉浸/轻量档单行高度（design §2 estimateSize 40px）。 */
export const WBS_ROW_HEIGHT_IMMERSIVE = 40
/** 精确档单行高度（高密度紧凑排版）。 */
export const WBS_ROW_HEIGHT_PRECISE = 32

/** 树形引导线几何常量（1px 发丝线，按 level*20px 递进缩进）。 */
const GUIDE_BAND = 20
/** 第 level 级树干引导线 x（位于该级缩进位内、内容箭头起点左 12px）。 */
const GUIDE_COL_X = (level: number) => 16 + GUIDE_BAND * level
/** 正交短横线长度：自树干列延伸至内容箭头起点。 */
const GUIDE_ELBOW_WIDTH = 12

/** 任务 6 状态 → 语义信号色令牌（与 D18 方案 A 确定性令牌一致）。 */
const WBS_TASK_STATUS_TOKEN: Record<TaskStatus, string> = {
  completed: '--nx-status-success',
  in_progress: '--nx-space-cyan',
  not_started: '--nx-text-muted',
  blocked: '--nx-status-danger',
  on_hold: '--nx-status-warning',
  cancelled: '--nx-text-muted',
}

/** 任务 6 状态 → 中文文案。 */
const WBS_TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  completed: '已完成',
  in_progress: '进行中',
  not_started: '未开始',
  blocked: '受阻',
  on_hold: '已挂起',
  cancelled: '已取消',
}

const TASK_STATUS_SET = new Set<string>([
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
])

function isTaskStatus(value: string | null | undefined): value is TaskStatus {
  return value !== null && value !== undefined && TASK_STATUS_SET.has(value)
}

/** 节点负载任务摘要 → 起止日期区间文本（缺省单边显示另一侧）。 */
function formatDateSpan(startDate: string | null, endDate: string | null): string | null {
  const parts = [startDate, endDate].filter((date): date is string => Boolean(date))
  return parts.length > 0 ? parts.join(' ~ ') : null
}

/** 仪器感 WBS 骨架加载屏：发丝边框 + 递进缩进脉冲条，杜绝首屏 CLS。 */
export function WorkspaceWbsLensSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-wbs-skeleton
      role="status"
      aria-label="正在加载 WBS 大纲"
      aria-busy="true"
      className={cn(
        'flex h-[600px] flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]',
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--nx-border-hairline)] px-3">
        <div className="h-6 w-16 animate-pulse rounded bg-[var(--nx-bg-1)]" />
        <div className="h-6 w-16 animate-pulse rounded bg-[var(--nx-bg-1)]" />
        <div className="ml-auto h-4 w-24 animate-pulse rounded bg-[var(--nx-bg-1)]" />
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-hidden px-4 py-4">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => (
          <div key={index} className="flex items-center gap-2">
            <div
              className="h-3.5 w-8 shrink-0 animate-pulse rounded bg-[var(--nx-bg-1)]"
              style={{ marginLeft: `${(index % 4) * 20}px` }}
            />
            <div
              className="h-3.5 animate-pulse rounded bg-[var(--nx-workspace-surface)]"
              style={{ width: `${Math.max(160, 320 - (index % 4) * 60)}px` }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 树形引导线层：按祖先层级绘制 1px 发丝垂直树干线与正交短横线。 */
function WbsTreeGuideLines({ depth }: { depth: number }) {
  if (depth <= 0) return null
  const ancestors = Array.from({ length: depth }, (_, index) => index)
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0">
      {ancestors.map((level) => (
        <React.Fragment key={level}>
          <span
            className="absolute inset-y-0 w-px bg-[var(--nx-border-hairline)]"
            style={{ left: GUIDE_COL_X(level) }}
          />
          {level === depth - 1 ? (
            <span
              className="absolute h-px bg-[var(--nx-border-hairline)]"
              style={{ left: GUIDE_COL_X(level), top: '50%', width: GUIDE_ELBOW_WIDTH }}
            />
          ) : null}
        </React.Fragment>
      ))}
    </div>
  )
}

/**
 * 单行可见 WBS 节点渲染：缩进 + 引导线 + 箭头 + 层次编码 + 名称 + 右侧任务/子项摘要。
 */
function WbsLensRow({
  item,
  height,
  precise,
  onToggle,
  onOpenTask,
  focused,
}: {
  item: VisibleWbsRowItem
  height: number
  precise: boolean
  onToggle: (nodeId: number) => void
  onOpenTask?: (taskId: number) => void
  focused?: boolean
}) {
  const { node, depth } = item
  const toggleable = item.hasChildren
  // 优先用子树汇总（一个工作包常挂多个任务）；旧接口无汇总时回退到节点直连任务
  const rollup = node.rollup
  const task = node.taskId !== null && node.task !== undefined ? node.task : undefined
  const status = rollup ? rollup.status : isTaskStatus(task?.status) ? task.status : undefined
  const dateSpan = rollup
    ? formatDateSpan(rollup.startDate, rollup.endDate)
    : task
      ? formatDateSpan(task.startDate, task.endDate)
      : null
  const hasSummary = Boolean(rollup || task)
  const nameLabel = `WBS ${node.code} ${node.name}`
  const boundTaskId = node.taskId
  const openBound = boundTaskId !== null && onOpenTask ? () => onOpenTask(boundTaskId) : undefined

  return (
    <div
      data-wbs-row
      data-wbs-node-id={node.id}
      data-wbs-depth={depth}
      data-task-id={boundTaskId ?? undefined}
      data-focused={focused ? 'true' : undefined}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={toggleable ? item.isExpanded : undefined}
      className={cn(
        'absolute left-0 top-0 flex w-full items-center overflow-hidden border-b border-[var(--nx-border-hairline)]/50',
        !precise && 'transition-colors hover:bg-[var(--nx-workspace-surface)]/60',
        focused && 'bg-[var(--nx-space-cyan)]/10 ring-1 ring-inset ring-[var(--nx-space-cyan)]/60',
      )}
      style={{ height }}
    >
      <div
        className="flex min-w-0 flex-1 items-center"
        style={{ paddingLeft: `min(${8 + depth * GUIDE_BAND}px, 20vw)` }}
      >
        <WbsTreeGuideLines depth={depth} />
        {toggleable ? (
          <button
            type="button"
            data-wbs-toggle
            aria-expanded={item.isExpanded}
            aria-label={`${item.isExpanded ? '折叠' : '展开'}：${node.name}`}
            onClick={() => onToggle(node.id)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                'h-3.5 w-3.5',
                !precise && 'transition-transform',
                item.isExpanded && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <span aria-hidden className="h-4 w-4 shrink-0" />
        )}
        <span
          data-wbs-code
          aria-hidden
          className="ml-1.5 shrink-0 font-mono text-[11px] leading-none text-[var(--nx-text-muted)]"
        >
          {node.code}
        </span>
        {openBound ? (
          <button
            type="button"
            data-wbs-node-name
            data-wbs-open-task
            title={`${nameLabel}（打开任务详情）`}
            onClick={openBound}
            className="ml-2 truncate text-left text-[13px] text-[var(--nx-text-primary)] hover:text-[var(--nx-space-cyan)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
          >
            {node.name}
          </button>
        ) : (
          <span
            data-wbs-node-name
            title={nameLabel}
            className="ml-2 truncate text-[13px] text-[var(--nx-text-primary)]"
          >
            {node.name}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 pr-3">
        {hasSummary && status ? (
          <div
            data-wbs-task-summary
            title={
              rollup
                ? `${rollup.taskCount} 个任务：完成 ${rollup.completedCount}、进行中 ${rollup.inProgressCount}、受阻 ${rollup.blockedCount}${dateSpan ? `；${dateSpan}` : ''}`
                : (dateSpan ?? undefined)
            }
            className="flex items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1"
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: `var(${WBS_TASK_STATUS_TOKEN[status]})` }}
            />
            <span
              className="text-[11px] leading-none"
              style={{ color: `var(${WBS_TASK_STATUS_TOKEN[status]})` }}
            >
              {WBS_TASK_STATUS_LABEL[status]}
            </span>
            {rollup ? (
              <>
                <span
                  data-wbs-rollup-count
                  className="font-mono text-[10px] leading-none text-[var(--nx-text-secondary)]"
                >
                  {rollup.completedCount}/{rollup.taskCount}
                </span>
                <span
                  aria-hidden
                  className="h-1 w-10 overflow-hidden rounded-full bg-[var(--nx-bg-0)]"
                >
                  <span
                    className="block h-full rounded-full bg-[var(--nx-status-success)]"
                    style={{ width: `${rollup.progressPercent}%` }}
                  />
                </span>
                {rollup.blockedCount > 0 ? (
                  <span
                    data-wbs-rollup-blocked
                    className="text-[10px] leading-none text-[var(--nx-status-danger)]"
                  >
                    {rollup.blockedCount} 受阻
                  </span>
                ) : null}
              </>
            ) : null}
            {dateSpan ? (
              <span className="font-mono text-[10px] leading-none text-[var(--nx-text-muted)]">
                {dateSpan}
              </span>
            ) : null}
          </div>
        ) : null}
        {!hasSummary && item.childCount > 0 ? (
          <span
            data-wbs-child-count
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[11px] leading-none text-[var(--nx-text-secondary)]"
          >
            {item.childCount} 个子项
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** 工作包下的任务行：状态点 + 名称 + 起止日期，点击打开详情。 */
function WbsTaskRow({
  task,
  depth,
  height,
  precise,
  focused,
  onOpenTask,
}: {
  task: WbsLensTask
  depth: number
  height: number
  precise: boolean
  focused: boolean
  onOpenTask?: (taskId: number) => void
}) {
  const status = isTaskStatus(task.status) ? task.status : undefined
  const dateSpan = formatDateSpan(task.startDate, task.endDate)
  const open = onOpenTask ? () => onOpenTask(task.id) : undefined
  return (
    <div
      data-wbs-task-row
      data-task-id={task.id}
      data-focused={focused ? 'true' : undefined}
      role="treeitem"
      aria-level={depth + 1}
      tabIndex={open ? 0 : undefined}
      title={open ? `${task.name}（打开任务详情）` : task.name}
      onClick={open}
      onKeyDown={(event) => {
        if (open && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          open()
        }
      }}
      className={cn(
        'absolute left-0 top-0 flex w-full items-center overflow-hidden border-b border-[var(--nx-border-hairline)]/50',
        open &&
          'cursor-pointer hover:bg-[var(--nx-workspace-surface)]/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--nx-border-focus)]',
        !precise && 'transition-colors',
        focused && 'bg-[var(--nx-space-cyan)]/10 ring-1 ring-inset ring-[var(--nx-space-cyan)]/60',
      )}
      style={{ height }}
    >
      <div
        className="flex min-w-0 flex-1 items-center"
        style={{ paddingLeft: `min(${8 + depth * GUIDE_BAND}px, 20vw)` }}
      >
        <WbsTreeGuideLines depth={depth} />
        <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: `var(${status ? WBS_TASK_STATUS_TOKEN[status] : '--nx-text-muted'})`,
            }}
          />
        </span>
        <span className="ml-1.5 shrink-0 text-[10px] leading-none text-[var(--nx-text-muted)]">
          任务
        </span>
        <span className="ml-2 truncate text-[12px] text-[var(--nx-text-secondary)]">
          {task.name}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 pr-3">
        {status ? (
          <span
            className="text-[11px] leading-none"
            style={{ color: `var(${WBS_TASK_STATUS_TOKEN[status]})` }}
          >
            {WBS_TASK_STATUS_LABEL[status]}
          </span>
        ) : null}
        {dateSpan ? (
          <span className="font-mono text-[10px] leading-none text-[var(--nx-text-muted)]">
            {dateSpan}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function WorkspaceWbsLens({
  projectId,
  className,
  onRenderComplete,
  onOpenTask,
  focusTaskId = null,
}: WorkspaceWbsLensProps) {
  const tier = useImmersionTier()

  // 减弱动效偏好监听（精确档降级第二通道：手动档位之外仍尊重系统设置）。
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(media.matches)
    const listener = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])
  const isPreciseMode = tier === 'precise' || prefersReducedMotion
  const mobile = useMobileWorkspace()
  const rowHeight = mobile ? 80 : isPreciseMode ? WBS_ROW_HEIGHT_PRECISE : WBS_ROW_HEIGHT_IMMERSIVE

  // 1. 数据取数（复用 wbsKeys.tree 缓存）
  const query = useWbsTree(projectId)
  const nodes = query.data ?? []

  // 2. 折叠集状态：初始尊重接口 collapsed 字段，用户接管后以本地集合为权威。
  const [collapsedIds, setCollapsedIds] = React.useState<Set<number> | null>(null)
  const serverCollapsed = React.useMemo(() => createInitialCollapsedSet(nodes), [nodes])
  const seededSignatureRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    const signature = nodes.map((node) => `${node.id}:${node.collapsed ? 1 : 0}`).join('|')
    if (seededSignatureRef.current === signature) return
    seededSignatureRef.current = signature
    if (collapsedIds === null && nodes.length > 0) {
      setCollapsedIds(createInitialCollapsedSet(nodes))
    }
  }, [nodes, collapsedIds])
  const effectiveCollapsed = collapsedIds ?? serverCollapsed

  // 3. 可见行拍平（纯函数，仅受折叠集影响）
  const visibleRows = React.useMemo(
    () => computeVisibleWbsRows(nodes, effectiveCollapsed),
    [nodes, effectiveCollapsed],
  )

  // 3b. 工作包下的任务行（与列表/看板共用 taskKeys.lists 前缀，任何地方改任务都会联动失效）
  const tasksQuery = useQuery({
    queryKey: [...taskKeys.lists(projectId), 'wbs-lens-all'] as const,
    queryFn: () => fetchAllProjectTasks(projectId),
    enabled: nodes.length > 0,
  })
  const lensTasks = tasksQuery.data
  const entries = React.useMemo(
    () => interleaveWbsTaskRows(visibleRows, lensTasks ?? [], effectiveCollapsed),
    [visibleRows, lensTasks, effectiveCollapsed],
  )

  // 4. 深度树虚拟化（活动 DOM 行数 ≤ 视口行 + overscan）
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  const toggleNode = React.useCallback((nodeId: number) => {
    setCollapsedIds((previous) => {
      const next = new Set(previous ?? [])
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  // 4b. 聚焦任务：展开祖先 → 滚动到该行（每个任务只自动定位一次）
  const focusedNodeId = React.useMemo(() => {
    if (!focusTaskId) return null
    const bound = nodes.find((node) => node.taskId === focusTaskId)
    if (bound) return bound.id
    return lensTasks?.find((task) => task.id === focusTaskId)?.wbsNodeId ?? null
  }, [focusTaskId, nodes, lensTasks])
  const expandedForFocusRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!focusTaskId || focusedNodeId === null) return
    if (expandedForFocusRef.current === focusTaskId) return
    expandedForFocusRef.current = focusTaskId
    const bound = nodes.some((node) => node.id === focusedNodeId && node.taskId === focusTaskId)
    const ancestors = wbsAncestorIds(nodes, focusedNodeId)
    // 绑定任务的节点本身不必展开；挂在工作包下的任务需要连工作包一起展开
    const toExpand = bound ? ancestors.slice(1) : ancestors
    setCollapsedIds((previous) => {
      const next = new Set(previous ?? effectiveCollapsed)
      for (const id of toExpand) next.delete(id)
      return next
    })
  }, [focusTaskId, focusedNodeId, nodes, effectiveCollapsed])
  const focusIndex = React.useMemo(
    () =>
      focusTaskId
        ? entries.findIndex((entry) =>
            entry.kind === 'task'
              ? entry.task.id === focusTaskId
              : entry.item.node.taskId === focusTaskId,
          )
        : -1,
    [entries, focusTaskId],
  )
  const scrolledForFocusRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!focusTaskId || focusIndex < 0 || scrolledForFocusRef.current === focusTaskId) return
    scrolledForFocusRef.current = focusTaskId
    rowVirtualizer.scrollToIndex(focusIndex, { align: 'center' })
  }, [focusTaskId, focusIndex, rowVirtualizer])

  // 5. 首屏渲染完成度量（数据就绪 → 可见树呈现耗时 + 活动行数）。
  //    virtualizer 在可见行数据提交后的布局阶段才实例化行 DOM，故采样延后一拍（setTimeout 0）。
  const dataReadyAtRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (query.data) dataReadyAtRef.current = performance.now()
  }, [query.data])
  const reportedRowsRef = React.useRef<VisibleWbsRowItem[] | null>(null)
  React.useEffect(() => {
    if (!onRenderComplete || visibleRows.length === 0) return
    if (reportedRowsRef.current === visibleRows) return
    reportedRowsRef.current = visibleRows
    const dataReadyAt = dataReadyAtRef.current ?? performance.now()
    const timer = window.setTimeout(() => {
      const activeElements = scrollRef.current?.querySelectorAll('[data-wbs-row]').length ?? 0
      onRenderComplete({
        durationMs: Math.max(0, performance.now() - dataReadyAt),
        activeElements,
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [visibleRows, onRenderComplete])

  // ── 状态分支：加载骨架 / 错误重试 / 空态引导 / 数据树 ──────────────────
  if (query.isLoading) {
    return <WorkspaceWbsLensSkeleton className={className} />
  }

  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : ''
    return (
      <div
        data-wbs-error
        role="alert"
        aria-label="WBS 大纲加载失败"
        className={cn(
          'flex h-[600px] flex-col items-center justify-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center',
          className,
        )}
      >
        <TriangleAlert className="h-8 w-8 text-[var(--nx-status-danger)]" aria-hidden />
        <p className="text-sm font-medium text-[var(--nx-text-primary)]">WBS 大纲加载失败</p>
        {message ? <p className="max-w-md text-xs text-[var(--nx-text-muted)]">{message}</p> : null}
        <button
          type="button"
          data-wbs-retry
          onClick={() => void query.refetch()}
          className="mt-1 inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          重新载入
        </button>
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div
        data-wbs-empty
        className={cn(
          'flex h-[600px] flex-col items-center justify-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center',
          className,
        )}
      >
        <Network className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-sm font-medium text-[var(--nx-text-primary)]">
          当前项目尚未创建 WBS 工作分解结构
        </p>
        <p className="max-w-md text-xs text-[var(--nx-text-muted)]">
          创建 AI 草案或工作分解后，即可在此俯瞰多级大纲结构与任务状态。
        </p>
      </div>
    )
  }

  return (
    <div
      data-wbs-lens
      data-wbs-tone={isPreciseMode ? 'precise' : 'immersive'}
      aria-label="WBS 结构俯瞰镜头"
      className={cn(
        'flex h-[600px] flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]',
        className,
      )}
    >
      {/* 顶部工具栏：展开全部 / 折叠至 L2（纯前端内存态，零写请求） */}
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-wbs-expand-all
            title="展开全部层级"
            onClick={() => setCollapsedIds(new Set())}
            className="inline-flex h-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            展开全部
          </button>
          <button
            type="button"
            data-wbs-collapse-l2
            title="仅保留根节点与一级子工作包展开"
            onClick={() => setCollapsedIds(buildCollapseToSecondLevelSet(nodes))}
            className="inline-flex h-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            折叠至 L2
          </button>
        </div>
        <p
          data-wbs-row-count
          className="shrink-0 font-mono text-[11px] text-[var(--nx-text-muted)]"
        >
          可见 {visibleRows.length} / {nodes.length} 节点
        </p>
      </div>

      {/* 虚拟滚动视口 */}
      <div
        ref={scrollRef}
        data-wbs-scroll-viewport
        role="tree"
        aria-label="WBS 大纲树"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {virtualRows.map((virtualRow) => {
            const entry = entries[virtualRow.index]
            if (!entry) return null
            return (
              <div
                key={entry.kind === 'node' ? entry.item.node.id : `task-${entry.task.id}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {entry.kind === 'node' ? (
                  <WbsLensRow
                    item={entry.item}
                    height={virtualRow.size}
                    precise={isPreciseMode}
                    onToggle={toggleNode}
                    onOpenTask={onOpenTask}
                    focused={focusTaskId !== null && entry.item.node.taskId === focusTaskId}
                  />
                ) : (
                  <WbsTaskRow
                    task={entry.task}
                    depth={entry.depth}
                    height={virtualRow.size}
                    precise={isPreciseMode}
                    focused={entry.task.id === focusTaskId}
                    onOpenTask={onOpenTask}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const WbsLens = WorkspaceWbsLens

export default WorkspaceWbsLens
