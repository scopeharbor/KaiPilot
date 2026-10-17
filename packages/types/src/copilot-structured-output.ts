/**
 * v3-copilot-structured-and-diagram-output —— 结构化产出块共享契约。
 *
 * 定义回合响应可携带的结构化产出块：表格、清单、图三类。
 * 与文本结论并列（D1：并列字段，非富文本标记）。
 *
 * 依赖约束：纯类型 + 确定性常量，零运行时依赖。
 * 不依赖 AdonisJS、React、数据库客户端、HTTP 客户端、外部网络。
 */

// ===========================================================================
// 来源引用（2.2 / 2.3 / 2.4）
// ===========================================================================

/**
 * 结构化块内每行/每条/每节点的来源引用。
 *
 * 红线：不可追溯的内容不得进入结构化块（design D7）。
 * 每行/每条/每节点至少一条 sourceRef（spec REQ traceability）。
 */
export interface CopilotStructuredSourceRef {
  /** 来源标识（如 document:123:page:2、task:456）。 */
  readonly sourceId: string
  /** 来源类型（如 document、task、ocr、knowledge）。 */
  readonly sourceKind: string
  /** 来源的有界摘要（≤120 字符，不含全文）。 */
  readonly summary: string
}

// ===========================================================================
// 表格块（2.2）
// ===========================================================================

/** 表格列声明。 */
export interface CopilotTableColumn {
  /** 列键（用于行数据索引）。 */
  readonly key: string
  /** 列显示标题（中文原生）。 */
  readonly label: string
  /** 列值类型（用于前端渲染）。 */
  readonly valueType: 'text' | 'number' | 'date' | 'status'
}

/** 表格行数据（值按列 key 索引）。 */
export interface CopilotTableRow {
  /** 列值映射。 */
  readonly values: Record<string, string | number | boolean | null>
  /** 本行的来源引用集合（至少一条）。 */
  readonly sourceRefs: readonly CopilotStructuredSourceRef[]
}

/**
 * 结构化表格块。
 *
 * 约束：
 * - 每行至少一条 sourceRef（spec REQ traceability）
 * - 超预算时截断并标记未显示行数（spec REQ truncation）
 * - 不含 prompt、模型输出全文、token 与 secret（spec REQ forbidden）
 */
export interface CopilotTableBlock {
  readonly kind: 'table'
  /** 表格标题。 */
  readonly title: string
  /** 列声明。 */
  readonly columns: readonly CopilotTableColumn[]
  /** 行数据。 */
  readonly rows: readonly CopilotTableRow[]
  /** 截断标记：未显示的行数。0 或缺省 = 无截断。 */
  readonly omittedRowCount: number
}

// ===========================================================================
// 清单块（2.3）
// ===========================================================================

/** 清单条目。 */
export interface CopilotListItem {
  /** 条目文本。 */
  readonly text: string
  /** 层级深度（0 = 顶层）。 */
  readonly depth: number
  /** 本条的来源引用集合（至少一条）。 */
  readonly sourceRefs: readonly CopilotStructuredSourceRef[]
}

/**
 * 结构化清单块。
 *
 * 约束：
 * - 每条至少一条 sourceRef（spec REQ traceability）
 * - 超预算时截断并标记未显示条数（spec REQ truncation）
 * - 不含 prompt、模型输出全文、token 与 secret（spec REQ forbidden）
 */
export interface CopilotListBlock {
  readonly kind: 'list'
  /** 清单标题。 */
  readonly title: string
  /** 条目列表。 */
  readonly items: readonly CopilotListItem[]
  /** 截断标记：未显示的条目数。0 或缺省 = 无截断。 */
  readonly omittedItemCount: number
}

// ===========================================================================
// 图块（2.4）
// ===========================================================================

/** 图类型枚举（复用 Mermaid 支持的类型）。 */
export const COPILOT_DIAGRAM_TYPES = [
  'wbs_tree',
  'gantt',
  'dependency_graph',
  'critical_path',
  'flowchart',
  'sequence',
  'class',
  'state',
] as const
export type CopilotDiagramType = (typeof COPILOT_DIAGRAM_TYPES)[number]

/** 图节点来源引用。 */
export interface CopilotDiagramNodeRef {
  /** 节点标识（Mermaid 节点 ID）。 */
  readonly nodeId: string
  /** 节点显示文本。 */
  readonly label: string
  /** 本节点的来源引用集合（至少一条）。 */
  readonly sourceRefs: readonly CopilotStructuredSourceRef[]
}

/** 守卫结论（spec REQ guard conclusion）。 */
export interface CopilotGuardConclusion {
  /** 守卫是否通过。 */
  readonly passed: boolean
  /** 拒绝原因（passed=false 时必填）。 */
  readonly rejectionReason?: string
  /** 拒绝原因分类（用于计数观测）。 */
  readonly rejectionCategory?: CopilotGuardRejectionCategory
}

/** 守卫拒绝原因分类（低敏计数用）。 */
export const COPILOT_GUARD_REJECTION_CATEGORIES = [
  'missing_metadata',
  'missing_confidence',
  'missing_assumptions',
  'missing_inputs',
  'executable_content',
  'click_callback',
  'script',
  'external_resource',
  'unsupported_type',
  'other',
] as const
export type CopilotGuardRejectionCategory = (typeof COPILOT_GUARD_REJECTION_CATEGORIES)[number]

/**
 * 结构化图块。
 *
 * 约束：
 * - 每节点至少一条 sourceRef（spec REQ traceability）
 * - 必须过既 `ai_diagram_guard` 校验（spec REQ guard）
 * - Mermaid 文本禁可执行内容（spec REQ no-executable）
 * - 超预算时截断并标记未显示节点数（spec REQ truncation）
 * - 不含 prompt、模型输出全文、token 与 secret（spec REQ forbidden）
 */
export interface CopilotDiagramBlock {
  readonly kind: 'diagram'
  /** 图标题。 */
  readonly title: string
  /** 图类型。 */
  readonly diagramType: CopilotDiagramType
  /** Mermaid 文本。 */
  readonly mermaidText: string
  /** 节点来源引用。 */
  readonly nodeRefs: readonly CopilotDiagramNodeRef[]
  /** 守卫结论。 */
  readonly guardConclusion: CopilotGuardConclusion
  /** 截断标记：未显示的节点数。0 或缺省 = 无截断。 */
  readonly omittedNodeCount: number
}

// ===========================================================================
// 块缺席原因（2.7）
// ===========================================================================

/** 块缺席原因枚举。 */
export const COPILOT_BLOCK_ABSENT_REASONS = [
  'guard_rejected',
  'no_traceable_content',
  'over_budget',
  'capability_unsupported',
  'empty_after_removal',
] as const
export type CopilotBlockAbsentReason = (typeof COPILOT_BLOCK_ABSENT_REASONS)[number]

/**
 * 块缺席记录。
 *
 * 当结构化块因故不呈现时，记录原因而非静默缺失。
 */
export interface CopilotBlockAbsent {
  readonly kind: 'absent'
  /** 本应呈现的块类型。 */
  readonly blockType: 'table' | 'list' | 'diagram'
  /** 缺席原因。 */
  readonly reason: CopilotBlockAbsentReason
  /** 可读的缺席说明（面向用户，有界低敏）。 */
  readonly detail: string
}

// ===========================================================================
// 结构化产出块集合（挂载到回合响应）
// ===========================================================================

/** 结构化产出块（并列字段，D1）。 */
export type CopilotStructuredBlock = CopilotTableBlock | CopilotListBlock | CopilotDiagramBlock

/** 块缺席记录（与块并列出现）。 */
export type CopilotStructuredBlockEntry = CopilotStructuredBlock | CopilotBlockAbsent

/**
 * 回合响应的结构化产出块集合。
 *
 * 作为 `CopilotTurnResponse` 的并列可选字段。
 * 旧客户端忽略未知字段即可（向后兼容）。
 */
export interface CopilotStructuredOutput {
  /** 结构化块列表（可包含缺席记录）。 */
  readonly blocks: readonly CopilotStructuredBlockEntry[]
  /** 文本结论集合（用于子集校验：块内结论 ⊆ 文本结论）。 */
  readonly textualConclusions: readonly string[]
  /** 总 token 估算（含结构化块）。 */
  readonly estimatedOutputTokens: number
}
