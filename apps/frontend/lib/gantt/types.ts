/**
 * 甘特渲染核 —— 运行时数据模型（T018 gantt-render-engine）。
 *
 * 契约对齐 `docs/v1/ai_project_os_sec10.md` DiagramSpec `GanttData`：
 * `GanttTask` / `GanttDependency` / `time_axis`。几何层沿用整数天偏移 + 固定 epoch
 * （design D5，见 `./geometry.ts`），避免每条图元过 D3 scale。
 *
 * 枚举**复用既有事实来源**，不另造：任务状态取 `@/lib/api/tasks` 的 `TaskStatus`（6 态状态机），
 * 依赖类型取 `@/lib/api/dependencies` 的 `DependencyType`（小写 fs/ss/ff/sf）。
 */

import type { TaskPriority, TaskStatus } from '@/lib/api/tasks'
import type { DependencyType } from '@/lib/api/dependencies'
import type { MilestoneStatus } from '@/lib/api/milestones'
import type { AssigneeType } from '@/types/agent-assignee'

export type { TaskStatus, DependencyType, MilestoneStatus }

/** 时间粒度（design：日/周/月/季四档，切换只重排坐标、不改底层数据）。 */
export type GanttGranularity = 'day' | 'week' | 'month' | 'quarter'

/** 图元种类：叶子任务 / 里程碑（零工期菱形）/ 父级阶段汇总条。 */
export type GanttRowKind = 'task' | 'milestone' | 'summary'

/** 负责人极简引用（简化入口显示头像/首字母）。 */
export interface GanttAssignee {
  id: number
  initials: string
  name: string
  /** v3-copilot-agent-as-assignee：负责人类别。 */
  assigneeType?: AssigneeType
  /** v3-copilot-agent-as-assignee：agent 模型标识。 */
  model?: string
}

/**
 * 渲染任务：几何以「距 epoch 的整数天偏移」表达（`startDay` / `durationDays`），
 * 与真实 ISO 日期解耦，保证可复现与快速像素换算。
 */
export interface GanttRenderTask {
  id: number
  name: string
  /** WBS outline 编号（"1.2.3"）；简化入口默认隐藏。 */
  wbsCode: string
  /** 层级深度（0 基）。 */
  depth: number
  parentId: number | null
  kind: GanttRowKind
  startDay: number
  /** 里程碑为 0。 */
  durationDays: number
  /** 完成度 0..1。 */
  progress: number
  status: TaskStatus
  /**
   * 5 级优先级（new-track 图元微标消费；旧轨组装源未就绪或 M0 数据集时为 undefined，
   * 渲染层兜底为 medium——next-gantt-adapter `buildNextGanttModel` 保证确定性）。
   */
  priority?: TaskPriority
  /** 真实里程碑行对应的实体 id；存在时该行不走任务排程/依赖编辑。 */
  milestoneId?: number
  assignee?: GanttAssignee
  /** 关键路径（上游 T021/基线未就绪时为 undefined，渲染层留通道不阻塞——design D7 / task 2.4）。 */
  isCritical?: boolean
  isOnLongestPath?: boolean
  totalFloat?: number
  /** 基线日期（超期视觉对照；上游未就绪时留空）。 */
  baselineStartDay?: number
  baselineEndDay?: number
  /** 实际开工 / 完工的天偏移（未开工为 undefined；进行中无完工日）——画「实际执行」细条。 */
  actualStartDay?: number
  actualEndDay?: number
}

/** 渲染依赖：successor 侧消费，type 决定锚点，`isCritical` 决定是否常显。 */
export interface GanttRenderDependency {
  id: number
  predecessorId: number
  successorId: number
  type: DependencyType
  lagDays: number
  isCritical?: boolean
}

/** 里程碑标记（可独立于任务，亦可由 `kind==='milestone'` 的任务派生）。 */
export interface GanttMilestoneMark {
  id: number
  taskId: number
  day: number
  name: string
  status: MilestoneStatus
}

/** 完整渲染模型（确定性数据集与 API 组装层的共同产物）。 */
export interface GanttModel {
  tasks: GanttRenderTask[]
  dependencies: GanttRenderDependency[]
  milestones: GanttMilestoneMark[]
  timeRange: { startDay: number; endDay: number }
  /** 天偏移 0 对应的真实时刻（用于时间轴标签本地化）。 */
  epochMs: number
}

export interface GanttScheduleDraft {
  taskId: number
  operation: 'move' | 'resize'
  startDay: number
  endDay: number
}

export interface GanttDependencyDraft {
  predecessorId: number
  successorId: number
  type: DependencyType
}

/**
 * 双入口 preset（design D6）：同渲染核 + 可见性配置，零数据分叉。
 * 差异只允许出现在可见性/密度/图元开关上（spec R1 红线）。
 */
export type GanttEntry = 'standard' | 'simplified'

/** 依赖线默认可见性策略。 */
export type DependencyDefaultVisibility =
  | 'muted' // 标准入口：视口内极弱 muted 常显裁剪子集
  | 'hidden' // 简化入口：默认隐藏常规连线（关键路径例外常显）

export interface GanttEntryPreset {
  entry: GanttEntry
  /** 常规依赖线默认态。 */
  dependencyDefault: DependencyDefaultVisibility
  /** 是否默认常显关键路径连线（两入口均 true——评审 Q2 定案）。 */
  alwaysShowCriticalPath: boolean
  /** 是否显示 WBS 编号列。 */
  showWbsCode: boolean
  /** 是否显示负责人头像/首字母。 */
  showAssigneeAvatar: boolean
  /** 是否暴露「显示全部依赖」显式开关（标准入口 true）。 */
  offerShowAllDependencies: boolean
}
