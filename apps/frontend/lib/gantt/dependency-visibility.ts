/**
 * 甘特依赖线 —— 可见性引擎（第一杠杆，design D3）。
 *
 * 「看不见就别画」的纯决策函数：给定可见行/时间窗、双入口 preset、悬停/选中、显示全部开关，
 * 把每条依赖归类为 **绘制**（muted/critical/highlight）、**聚合为边缘徽标**、或 **跳过**。
 *
 * 规则（评审定案）：
 * - 三级裁剪：①端点视口裁剪（两端离屏→跳过，4.3）②上下文显示（标准默认极弱 muted、简化默认隐藏；
 *   悬停/选中显示该任务依赖链，4.4）③越界依赖聚合为行边缘计数徽标（4.6）。
 * - 关键路径连线两入口默认常显（含简化入口，4.5）；「显示全部依赖」开关绕过上下文裁剪（4.9）。
 * - 样式优先级：highlight（悬停链）> critical（关键路径）> muted（默认/显示全部）。
 * - 裁剪是隐藏非删除：被聚合的依赖 id 随徽标返回，可就地展开重新绘制（4.9）。
 *
 * 纯函数、无副作用、可单测。几何/索引由 `./dependency-index` 预算好传入（4.7）。
 */

import type { DepEndpoints, DependencyIndex } from './dependency-index'
import type { DependencyDefaultVisibility } from './types'
import type { GanttRenderDependency } from './types'

export type DependencyStyle = 'muted' | 'critical' | 'problem' | 'highlight'

/** 一条待绘制依赖（图表绝对坐标；`clipped` 表示有一端在视口外、连到边界）。 */
export interface DrawnDependency {
  id: number
  x1: number
  y1: number
  x2: number
  y2: number
  style: DependencyStyle
  clipped: boolean
}

/** 越界依赖聚合徽标：某可见行某一侧有 N 条依赖的另一端在视口外。 */
export interface EdgeBadge {
  rowIndex: number
  /** lead=入向（前置在屏外）、trail=出向（后置在屏外）。 */
  side: 'lead' | 'trail'
  count: number
  /** 被折叠的依赖 id（供就地展开）。 */
  depIds: number[]
  /** 可见端点的图表绝对 x（徽标就近锚定到对应任务边）。 */
  anchorX: number
  /** 可见端点的图表绝对 y。 */
  anchorY: number
}

export interface DependencyVisibility {
  lines: DrawnDependency[]
  badges: EdgeBadge[]
}

export interface VisibilityInput {
  deps: GanttRenderDependency[]
  endpoints: Map<number, DepEndpoints>
  index: DependencyIndex
  /** 可见行号集合（含缓冲）。 */
  visibleRows: Set<number>
  /** 可见行区间（供索引查询）。 */
  rowRange: { minRow: number; maxRow: number }
  /** 可见像素区间（横向裁剪，含缓冲）。 */
  pxRange: { minX: number; maxX: number }
  /** 依赖线默认态（标准 muted / 简化 hidden）。 */
  dependencyDefault: DependencyDefaultVisibility
  /** 两入口默认常显关键路径。 */
  alwaysShowCriticalPath: boolean
  /** 问题链常显开关：端点落在问题任务集（受阻/逾期）的依赖常显。 */
  showProblemChain?: boolean
  /** 问题任务集（受阻/逾期）。 */
  problemTaskIds?: Set<number>
  /** 悬停任务（优先于选中驱动依赖链高亮）。 */
  hoveredTaskId: number | null
  selectedTaskId: number | null
  /** 标准入口「显示全部依赖」开关：绕过上下文裁剪。 */
  showAllDependencies: boolean
  /** 已展开的徽标（"rowIndex:side"），其折叠依赖改为绘制到边界。 */
  expandedBadges?: Set<string>
}

function endpointInView(
  row: number,
  x: number,
  visibleRows: Set<number>,
  pxRange: { minX: number; maxX: number },
): boolean {
  return visibleRows.has(row) && x >= pxRange.minX && x <= pxRange.maxX
}

export function badgeKey(rowIndex: number, side: 'lead' | 'trail'): string {
  return `${rowIndex}:${side}`
}

/**
 * 计算当前视口下的依赖可见性。返回待绘制连线与聚合徽标。
 * 只处理与可见行相交的候选依赖（索引 O(命中)），两端全离屏者天然被跳过。
 */
export function computeDependencyVisibility(input: VisibilityInput): DependencyVisibility {
  const {
    deps,
    endpoints,
    index,
    visibleRows,
    rowRange,
    pxRange,
    dependencyDefault,
    alwaysShowCriticalPath,
    showProblemChain,
    problemTaskIds,
    hoveredTaskId,
    selectedTaskId,
    showAllDependencies,
    expandedBadges,
  } = input

  const activeTask = hoveredTaskId ?? selectedTaskId
  const depById = new Map(deps.map((d) => [d.id, d]))
  const candidates = index.incidentToRange(rowRange.minRow, rowRange.maxRow)

  const lines: DrawnDependency[] = []
  const badgeMap = new Map<string, EdgeBadge>()

  for (const depId of candidates) {
    const dep = depById.get(depId)
    const geo = endpoints.get(depId)
    if (!dep || !geo) continue

    const predInView = endpointInView(geo.predRow, geo.x1, visibleRows, pxRange)
    const succInView = endpointInView(geo.succRow, geo.x2, visibleRows, pxRange)
    // 端点视口裁剪：两端都不在视口 → 跳过（4.3）。
    if (!predInView && !succInView) continue

    const isCritical = Boolean(dep.isCritical) && alwaysShowCriticalPath
    const isProblem =
      Boolean(showProblemChain) &&
      problemTaskIds !== undefined &&
      (problemTaskIds.has(dep.predecessorId) || problemTaskIds.has(dep.successorId))
    const inHoverChain =
      activeTask !== null && (dep.predecessorId === activeTask || dep.successorId === activeTask)

    // 是否「应显示」：关键路径 / 问题链 / 悬停链 / 显示全部 / 标准入口默认 muted。
    const shownByDefault = dependencyDefault === 'muted' || showAllDependencies
    const shown = isCritical || isProblem || inHoverChain || shownByDefault
    if (!shown) continue

    // 样式优先级：highlight（悬停）> critical（关键路径）> problem（问题链）> muted。
    const style: DependencyStyle = inHoverChain
      ? 'highlight'
      : isCritical
        ? 'critical'
        : isProblem
          ? 'problem'
          : 'muted'
    const bothInView = predInView && succInView
    // 重要连线（关键路径/问题链/悬停链/显示全部）即便一端离屏也绘制到边界；
    // 仅「默认 muted」的单端可见连线走聚合，避免长线拉向屏外制造蛛网。
    const important = isCritical || isProblem || inHoverChain || showAllDependencies

    if (bothInView || important) {
      lines.push({
        id: dep.id,
        x1: geo.x1,
        y1: geo.y1,
        x2: geo.x2,
        y2: geo.y2,
        style,
        clipped: !bothInView,
      })
      continue
    }

    // 默认 muted 且恰一端可见 → 聚合到可见端所在行的对应侧。
    // 可见端是后置（前置离屏）→ 入向徽标 lead；可见端是前置（后置离屏）→ 出向徽标 trail。
    const visibleRow = succInView ? geo.succRow : geo.predRow
    const side: 'lead' | 'trail' = succInView ? 'lead' : 'trail'
    const anchorX = succInView ? geo.x2 : geo.x1
    const anchorY = succInView ? geo.y2 : geo.y1
    const key = badgeKey(visibleRow, side)

    if (expandedBadges?.has(key)) {
      lines.push({
        id: dep.id,
        x1: geo.x1,
        y1: geo.y1,
        x2: geo.x2,
        y2: geo.y2,
        style: 'muted',
        clipped: true,
      })
      continue
    }

    const badge = badgeMap.get(key)
    if (badge) {
      badge.count++
      badge.depIds.push(dep.id)
    } else {
      badgeMap.set(key, {
        rowIndex: visibleRow,
        side,
        count: 1,
        depIds: [dep.id],
        anchorX,
        anchorY,
      })
    }
  }

  return { lines, badges: [...badgeMap.values()] }
}
