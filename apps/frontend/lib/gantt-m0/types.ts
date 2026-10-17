/**
 * gantt-performance-poc / M0 —— 渲染器可换的契约边界（design D3）。
 *
 * 这是一个 DiagramSpec 形状的**最小**输入类型：任务 / 依赖 / 里程碑 / 时间范围。
 * 纯 SVG（方案 A）、SVG+Canvas 混合（方案 B）与 frappe-gantt 降级适配层都只消费本类型，
 * 从而在不改上层数据/交互的前提下替换渲染实现。
 *
 * 时间以「距项目起点的整数天偏移」表达（`startDay` / `endDay` / `lagDays`），刻意不使用
 * `Date`：一是保证 fixture 逐位可复现（禁用 `Date.now`），二是把「日历映射」下沉到渲染层
 * 的固定 epoch 常量，避免把机器时区/当前时间混入基准数据集。
 *
 * 留存资产：本文件与 `dataset.ts`、`measure.ts` 在 M0 归档后保留，供 T018 `gantt-render-engine`
 * 复用为 CI 性能回归门禁；一次性的 A/B 实验渲染代码不在此列。
 */

/** 六状态存储口径，与后端 `task-status-workflow` 单一事实来源一致（ADR-010）。 */
export type GanttTaskStatus =
  'not_started' | 'in_progress' | 'completed' | 'blocked' | 'on_hold' | 'cancelled'

export const GANTT_TASK_STATUSES: readonly GanttTaskStatus[] = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
]

/** 四类依赖：Finish-Start / Start-Start / Finish-Finish / Start-Finish。 */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF'

export const DEPENDENCY_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF']

export interface GanttTask {
  id: number
  name: string
  /** WBS outline 编号，如 `"1.2.3"`。 */
  wbsCode: string
  /** 0 基 WBS 深度（0 = 顶层）。 */
  depth: number
  parentId: number | null
  /** 距项目起点的整数天偏移（≥0）。 */
  startDay: number
  /** 工期天数；里程碑为 0。 */
  durationDays: number
  /** 完成度 0..1。 */
  progress: number
  status: GanttTaskStatus
  isMilestone: boolean
}

export interface GanttDependency {
  id: number
  predecessorId: number
  successorId: number
  type: DependencyType
  /** 迟滞天数（可为负，POC 仅用非负）。 */
  lagDays: number
}

export interface GanttMilestone {
  id: number
  taskId: number
  /** 里程碑落点（整数天偏移）。 */
  day: number
}

export interface GanttSpec {
  seed: number
  tasks: GanttTask[]
  dependencies: GanttDependency[]
  milestones: GanttMilestone[]
  /** 整数天定义域，供时间轴比例尺使用。 */
  timeRange: { startDay: number; endDay: number }
}

/** 数据集统计速览：供控制面板展示与测试断言复现性/复杂度契约。 */
export interface GanttSpecSummary {
  taskCount: number
  dependencyCount: number
  milestoneCount: number
  maxDepth: number
  statusCounts: Record<GanttTaskStatus, number>
  dependencyTypeCounts: Record<DependencyType, number>
  spanDays: number
}
