/**
 * 甘特叠加层优先级（design D6 / spec R6）。
 *
 * 同一任务或依赖可能同时命中多种状态（拖拽 preview、冲突、选中链路、关键路径、问题链、基线偏差、
 * 常规依赖）。为避免多重高饱和边框互相遮挡导致用户无法判断当前状态，**渲染层必须遵守固定优先级**：
 * 高优先级状态可见并决定主样式；被覆盖的低优先级状态改由 tooltip/详情面板解释（`describeOverlay`）。
 *
 * 纯函数、无副作用、可单测（task 4.6）。
 */

/** 叠加层种类，**数组顺序即优先级**（下标越小优先级越高）。 */
export const OVERLAY_PRIORITY = [
  'preview', // 当前拖拽/编辑 preview
  'conflict', // 冲突/错误
  'selectedChain', // 选中链路
  'criticalPath', // 关键路径
  'problemChain', // 问题链（受阻/逾期）
  'baselineDeviation', // 基线偏差
  'dependency', // 常规依赖
  'base', // 弱化背景
] as const

export type GanttOverlayKind = (typeof OVERLAY_PRIORITY)[number]

const RANK: Record<GanttOverlayKind, number> = OVERLAY_PRIORITY.reduce(
  (acc, kind, index) => {
    acc[kind] = index
    return acc
  },
  {} as Record<GanttOverlayKind, number>,
)

/** 中文标签（用于组合详情说明）。 */
export const OVERLAY_LABEL: Record<GanttOverlayKind, string> = {
  preview: '排程预览',
  conflict: '冲突',
  selectedChain: '选中链路',
  criticalPath: '关键路径',
  problemChain: '问题链',
  baselineDeviation: '基线偏差',
  dependency: '依赖',
  base: '常规',
}

/** 数值优先级（越小越高）；未知种类回落到最低。 */
export function overlayRank(kind: GanttOverlayKind): number {
  return RANK[kind] ?? OVERLAY_PRIORITY.length
}

/**
 * 从命中的多个状态中选出**主样式**（优先级最高者）。空集合回落 `base`。
 */
export function resolveOverlay(active: Iterable<GanttOverlayKind>): GanttOverlayKind {
  let winner: GanttOverlayKind = 'base'
  let best = Infinity
  for (const kind of active) {
    const rank = overlayRank(kind)
    if (rank < best) {
      best = rank
      winner = kind
    }
  }
  return winner
}

/**
 * 组合详情说明：主状态 + 被覆盖的次要状态列表（按优先级排序），供 tooltip/详情面板呈现，
 * 使高优先级不吞掉低优先级的语义（spec 场景「冲突覆盖普通叠加」要求详情仍说明基线滞后+关键路径）。
 */
export function describeOverlay(active: Iterable<GanttOverlayKind>): {
  primary: GanttOverlayKind
  secondary: GanttOverlayKind[]
} {
  const sorted = [...new Set(active)].sort((a, b) => overlayRank(a) - overlayRank(b))
  const primary = sorted[0]
  if (primary === undefined) return { primary: 'base', secondary: [] }
  return { primary, secondary: sorted.slice(1).filter((k) => k !== 'base') }
}
