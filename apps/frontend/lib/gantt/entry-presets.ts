/**
 * 甘特双入口 preset（design D6 / spec R1）。
 *
 * 同一渲染核 + 同一数据，仅由可见性/密度/图元开关拉开差异，**零数据分叉、零后端分叉**。
 * 评审定案（2026-07-05）：
 * - 标准入口：常规依赖线「视口内极弱 muted」常显 + 关键路径常显 + 「显示全部依赖」开关；WBS 编号可见。
 * - 简化入口：常规依赖线默认隐藏、换头像/大圆角条；**但关键路径连线仍常显**（Q2 覆盖 Q6 一角——
 *   卡完工的主链对新手同样保留）。
 */

import type { GanttEntry, GanttEntryPreset } from './types'

export const GANTT_ENTRY_PRESETS: Record<GanttEntry, GanttEntryPreset> = {
  standard: {
    entry: 'standard',
    dependencyDefault: 'muted',
    alwaysShowCriticalPath: true,
    showWbsCode: true,
    showAssigneeAvatar: false,
    offerShowAllDependencies: true,
  },
  simplified: {
    entry: 'simplified',
    dependencyDefault: 'hidden',
    alwaysShowCriticalPath: true, // 交叉修正：简化入口零常规连线，但关键路径例外常显。
    showWbsCode: false,
    showAssigneeAvatar: true,
    offerShowAllDependencies: false,
  },
}

export function getEntryPreset(entry: GanttEntry): GanttEntryPreset {
  return GANTT_ENTRY_PRESETS[entry]
}
