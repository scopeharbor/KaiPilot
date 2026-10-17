/**
 * diagram-spec-minimum-contract —— V1 DiagramSpec 最小共享契约（前后端共享）。
 *
 * 契约来源：`openspec/changes/diagram-spec-minimum-contract/specs/diagram-spec-minimum-contract/spec.md`
 *   - 需求「DiagramSpec 最小信封」：version / type / title / data / metadata 必填；
 *   - 需求「V1 图表类型白名单」：wbs_tree / gantt / dependency_graph / critical_path
 *     （v3-ui-next-chart-gallery 起扩充 fishbone：鱼骨图因果分析）；
 *   - 需求「DiagramSpec 不得成为业务事实来源」：通过 EntityRef 引用正式实体；
 *   - 需求「Mermaid 单向导出」：exports.mermaid 声明导出能力与限制。
 *
 * 纯静态类型 + const 数组，零运行时依赖（同 @aiproj/types 其他模块）。
 * 校验函数在后端 apps/backend/app/services/diagram_spec_validator.ts 实现。
 */

// ---------------------------------------------------------------------------
// V1 图表类型白名单
// ---------------------------------------------------------------------------

export const DIAGRAM_SPEC_VERSION = '1.0' as const
export type DiagramSpecVersion = typeof DIAGRAM_SPEC_VERSION

export const DIAGRAM_TYPES = [
  'wbs_tree',
  'gantt',
  'dependency_graph',
  'critical_path',
  'fishbone', // v3-ui-next-chart-gallery：鱼骨图/石川图因果分析（6M 骨架）
] as const
export type DiagramType = (typeof DIAGRAM_TYPES)[number]

/**
 * 运行时守卫：判定任意字符串是否为 V1 白名单类型。
 */
export function isDiagramType(value: string): value is DiagramType {
  return (DIAGRAM_TYPES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// 实体引用（DiagramSpec 节点/边/任务条指向正式项目实体的最小引用）
// ---------------------------------------------------------------------------

export const ENTITY_REF_TYPES = ['task', 'wbs_node', 'milestone', 'dependency', 'resource'] as const
export type EntityRefType = (typeof ENTITY_REF_TYPES)[number]

/**
 * EntityRef —— DiagramSpec 中可交互元素对正式项目实体的引用。
 * 前端通过 entityType + entityId 下钻到真实数据。
 */
export interface EntityRef {
  entityType: EntityRefType
  entityId: number
  /** 可选：实体的显示名称，用于 Mermaid 标签或预览 UI */
  label?: string
}

// ---------------------------------------------------------------------------
// 来源元数据
// ---------------------------------------------------------------------------

export const DIAGRAM_SOURCE_TYPES = ['system', 'user', 'ai'] as const
export type DiagramSourceType = (typeof DIAGRAM_SOURCE_TYPES)[number]

/**
 * DiagramMetadata —— 每份 DiagramSpec 必须携带的来源与可追溯信息。
 */
export interface DiagramMetadata {
  /** 生成来源：system = 系统从正式数据生成；user = 用户手动创建；ai = AI 草案生成 */
  generatedBy: DiagramSourceType
  /** 生成时间 ISO-8601 */
  generatedAt: string
  /** 源项目 ID */
  sourceProjectId: number
  /** 源数据时间戳或数据指纹，用于识别陈旧 */
  sourceDataHash?: string
  /** 源数据最后更新时间 ISO-8601 */
  sourceDataTimestamp?: string
  /** AI 生成时必填：置信度 0..1 */
  confidence?: number
  /** AI 生成时必填：假设列表 */
  assumptions?: string[]
  /** AI 生成时必填：缺失输入信息列表 */
  missingInputs?: string[]
  /** AI 生成时：草案来源 ID */
  sourceDraftId?: string
  /** AI 生成时：草案版本号 */
  sourceDraftVersion?: number
}

// ---------------------------------------------------------------------------
// 导出提示
// ---------------------------------------------------------------------------

export interface MermaidExportHint {
  /** 是否支持 Mermaid 导出 */
  supported: boolean
  /** 导出时无法表达的信息，进入 warnings */
  limitations?: string[]
}

/**
 * DiagramExportHints —— 声明各导出格式的支持状态。
 */
export interface DiagramExportHints {
  mermaid: MermaidExportHint
}

// ---------------------------------------------------------------------------
// WBS 树 data 结构
// ---------------------------------------------------------------------------

export interface WbsTreeNode {
  /** WBS 节点 ID */
  id: number
  /** WBS 编码，如 "1.2.3" */
  code: string
  /** 节点名称 */
  name: string
  /** 父节点 ID，根节点为 null */
  parentId: number | null
  /** 是否为叶子节点 */
  isLeaf: boolean
  /** 层级深度 */
  depth: number
  /** 关联的任务实体引用（可选） */
  entityRef?: EntityRef
}

export interface WbsTreeData {
  nodes: WbsTreeNode[]
}

// ---------------------------------------------------------------------------
// 甘特图 data 结构
// ---------------------------------------------------------------------------

export interface GanttBar {
  /** 任务 ID */
  taskId: number
  /** 任务名称 */
  name: string
  /** 开始日期 ISO-8601 */
  startDate: string | null
  /** 结束日期 ISO-8601 */
  endDate: string | null
  /** 进度百分比 0..100 */
  progress: number
  /** 是否在关键路径上 */
  isCriticalPath: boolean
  /** 关联依赖的 taskId 列表 */
  dependencies: number[]
  /** 实体引用 */
  entityRef: EntityRef
}

export interface GanttMilestone {
  milestoneId: number
  name: string
  date: string
  entityRef: EntityRef
}

export interface GanttData {
  bars: GanttBar[]
  milestones: GanttMilestone[]
  /** 时间轴起始日期 ISO-8601 */
  timelineStart: string
  /** 时间轴结束日期 ISO-8601 */
  timelineEnd: string
}

// ---------------------------------------------------------------------------
// 依赖图 data 结构
// ---------------------------------------------------------------------------

export interface DependencyEdge {
  fromTaskId: number
  toTaskId: number
  /** 依赖类型：FS/FF/SS/SF */
  type: string
}

export interface DependencyGraphNode {
  taskId: number
  name: string
  entityRef: EntityRef
}

export interface DependencyGraphData {
  nodes: DependencyGraphNode[]
  edges: DependencyEdge[]
}

// ---------------------------------------------------------------------------
// 关键路径 data 结构
// ---------------------------------------------------------------------------

export interface CriticalPathNode {
  taskId: number
  name: string
  /** 最早开始 ISO-8601 */
  earliestStart: string | null
  /** 最早结束 ISO-8601 */
  earliestFinish: string | null
  /** 最晚开始 ISO-8601 */
  latestStart: string | null
  /** 最晚结束 ISO-8601 */
  latestFinish: string | null
  /** 总浮动时间（天） */
  totalFloat: number
  entityRef: EntityRef
}

export interface CriticalPathData {
  nodes: CriticalPathNode[]
  /** 关键路径上的 taskId 有序列表 */
  path: number[]
}

// ---------------------------------------------------------------------------
// 鱼骨图 data 结构（v3-ui-next-chart-gallery —— 6M 因果分析骨架）
// ---------------------------------------------------------------------------

/**
 * FishboneCauseNode —— 鱼骨图原因分支节点（大骨下的中骨/小骨递归嵌套）。
 * id 为图内稳定标识（前端编辑期生成，UUID/自增均可），不指向正式业务实体。
 */
export interface FishboneCauseNode {
  /** 原因节点图内标识 */
  id: string
  /** 原因内容（如「缺乏交叉审查机制」） */
  label: string
  /** 子原因（小骨） */
  children?: FishboneCauseNode[]
}

/**
 * FishboneCategory —— 鱼骨图大骨分类（经典 6M：人/机/料/法/环/测，支持自定义）。
 */
export interface FishboneCategory {
  /** 大骨标识（manpower / machinery / material / method / measurement / environment 或自定义） */
  key: string
  /** 大骨显示名（如「人员 Manpower」） */
  label: string
  /** 该大骨下的原因分支 */
  causes: FishboneCauseNode[]
}

/**
 * FishboneData —— 鱼骨图 data 结构：水平主脊椎右端为核心问题（effect），
 * 上下斜向展开大骨分类与递归原因树。
 */
export interface FishboneData {
  /** 核心问题 / 目标效果陈述（Problem Statement / Effect） */
  effect: string
  /** 大骨分类与要因树 */
  categories: FishboneCategory[]
}

// ---------------------------------------------------------------------------
// DiagramSpec 信封（V1 最小契约）
// ---------------------------------------------------------------------------

export type DiagramSpecData =
  WbsTreeData | GanttData | DependencyGraphData | CriticalPathData | FishboneData

/**
 * DiagramSpec —— V1 最小共享信封。
 * 所有字段必填；version 固定为 "1.0"；type 必须在白名单内。
 */
export interface DiagramSpec {
  /** 协议版本，V1 固定为 "1.0" */
  version: DiagramSpecVersion
  /** 图表类型，V1 白名单：wbs_tree | gantt | dependency_graph | critical_path | fishbone */
  type: DiagramType
  /** 图表标题 */
  title: string
  /** 类型相关的图表数据 */
  data: DiagramSpecData
  /** 来源与可追溯元数据 */
  metadata: DiagramMetadata
  /** 导出能力声明 */
  exports: DiagramExportHints
}

// ---------------------------------------------------------------------------
// 图表记录（后端存储实体）
// ---------------------------------------------------------------------------

/**
 * Diagram —— 后端 diagrams 表对应的领域实体（共享类型，供前后端使用）。
 */
export interface Diagram {
  id: number
  organizationId: number
  projectId: number
  type: DiagramType
  title: string
  /** DiagramSpec JSON（存储时序列化为字符串） */
  spec: DiagramSpec
  /** 源数据指纹，用于陈旧检测 */
  sourceHash: string | null
  createdBy: number
  updatedBy: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Mermaid 导出结果
// ---------------------------------------------------------------------------

export interface MermaidExportResult {
  /** Mermaid 文本 */
  mermaid: string
  /** 无法表达的高级图元警告 */
  warnings: string[]
}
