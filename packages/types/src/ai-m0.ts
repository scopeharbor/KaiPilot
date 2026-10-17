/**
 * ai-structured-output-poc / M0 —— 前后端共享的草案 schema 与 AIMarker 契约。
 *
 * 契约来源：`openspec/changes/ai-structured-output-poc/specs/ai-structured-output-baseline/spec.md`
 *   - 需求「M0 假设标记必须覆盖必填推断字段且可被审查骨架展示」；
 *   - 需求「M0 结构化一致性必须按分布口径三档测量」；
 *   - 需求「M0 通过判定必须以完整链路为前提且达标放行」。
 *
 * 类型定义纯静态，禁止依赖 zod / adonisjs 等运行时（`@aiproj/types` 是零依赖 workspace 包）。
 * zod schema（用于运行时校验）在后端 `apps/backend/app/services/ai_m0/schema.ts` 与前端
 * `apps/frontend/lib/ai-m0/schema.ts` 独立定义，两侧共用本文件的静态类型作为唯一 source-of-truth。
 */

// ---------------------------------------------------------------------------
// AIMarker —— 反幻觉最小契约（design D8 / spec §7.1）
// ---------------------------------------------------------------------------

/** AIMarker.source：字段来源分类。 */
export const AI_MARKER_SOURCES = ['inferred', 'explicit', 'default'] as const
export type AiMarkerSource = (typeof AI_MARKER_SOURCES)[number]

/**
 * AIMarker —— 挂在每个 AI 推断字段上的最小反幻觉标记。
 *
 * 语义（spec 硬约束）：
 * - `confidence`：0..1，五维置信度合并（POC 阶段先按 Adapter 估算，最终值由 `ai-anti-hallucination` 落地）；
 * - `source`：`inferred` = AI 推断；`explicit` = 用户显式提供；`default` = 系统兜底缺省；
 * - `reason`：一段简体中文文本，解释推断依据（供 DraftReviewPanel 展示给用户判断）；
 * - `needsConfirmation`：**高风险字段强制 true**（工期/日期/预算/资源）。
 *   任一必填推断字段缺失完整 AIMarker，spec 需求「必填推断字段覆盖率必须为 100%」判定失败。
 */
export interface AiMarker {
  confidence: number
  source: AiMarkerSource
  reason: string
  needsConfirmation: boolean
}

/** 泛型包装：把任意值 `T` 挂上 AIMarker。`Marked<Date>` = 有标记的日期字段。 */
export interface Marked<T> {
  value: T
  marker: AiMarker
}

// ---------------------------------------------------------------------------
// 草案 schema（章程 + WBS + 任务 + 验收标准，spec §2.2）
// ---------------------------------------------------------------------------

/** 与后端 `Task` 表 6 状态保持一致（`docs/v1/ai_project_os_sec06.md`）。 */
export const DRAFT_TASK_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
] as const
export type DraftTaskStatus = (typeof DRAFT_TASK_STATUSES)[number]

/** 依赖关系类型：与后端 task_dependencies 表保持一致。 */
export const DRAFT_DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const
export type DraftDependencyType = (typeof DRAFT_DEPENDENCY_TYPES)[number]

/**
 * 项目章程（Charter）—— 一句话输入经 AI 推断后的项目定位；所有字段都是推断，均需 AIMarker。
 */
export interface DraftCharter {
  title: Marked<string>
  vision: Marked<string>
  scope: Marked<string>
  successCriteria: Marked<string[]>
  /** 项目预计起止日期（ISO date，字符串形式跨端安全）。 */
  startDate: Marked<string>
  endDate: Marked<string>
}

/**
 * WBS 节点（工作分解结构，任意层级树）。
 *
 * 每个节点带 `outlineCode`（如 `1.2.3`）与父引用；层级由 `docs/v1/v1-development-baseline.md` §2 限定为 3~20 层。
 * POC 阶段不校验层级上限（属 `build-wbs-tree` 已归档规范），只保证结构完整。
 */
export interface DraftWbsNode {
  id: string
  parentId: string | null
  outlineCode: string
  name: Marked<string>
  description: Marked<string>
  children: DraftWbsNode[]
}

/** 任务：叶子级工作项，挂在 WBS 叶子节点下。 */
export interface DraftTask {
  id: string
  wbsNodeId: string
  name: Marked<string>
  description: Marked<string>
  status: DraftTaskStatus
  /** 计划工期（天），高风险推断，强制 needsConfirmation。 */
  durationDays: Marked<number>
  startDate: Marked<string>
  endDate: Marked<string>
  /** 前置任务（软引用，POC 阶段用 ID）。 */
  dependencies: DraftTaskDependency[]
  assigneeHint: Marked<string>
}

export interface DraftTaskDependency {
  predecessorId: string
  type: DraftDependencyType
  /** lag 天数（可负数表示提前），高风险推断需 marker（POC 阶段简化：只在非 0 时标 needsConfirmation）。 */
  lagDays: Marked<number>
}

/** 验收标准：项目结项的判据（用于确认时逐条勾选）。 */
export interface DraftAcceptanceCriterion {
  id: string
  statement: Marked<string>
  /** 与 charter.successCriteria 的对应索引（POC 阶段可为 null）。 */
  linkedSuccessIndex: number | null
}

/** POC 顶层草案结构。 */
export interface AiProjectDraft {
  charter: DraftCharter
  wbs: DraftWbsNode[]
  tasks: DraftTask[]
  acceptanceCriteria: DraftAcceptanceCriterion[]
}

// ---------------------------------------------------------------------------
// 策略与评测协议（spec §2/§3/§4/§5）
// ---------------------------------------------------------------------------

/** Schema 约束策略：P/N/T 三策略对照实验（design D4）。 */
export const AI_M0_STRATEGIES = ['prompt', 'native', 'tool'] as const
export type AiM0Strategy = (typeof AI_M0_STRATEGIES)[number]

/** 输入集分类，覆盖软件/活动/研究/产品四类（spec 硬约束）。 */
export const AI_M0_INPUT_CATEGORIES = ['software', 'event', 'research', 'product'] as const
export type AiM0InputCategory = (typeof AI_M0_INPUT_CATEGORIES)[number]

/**
 * 评测输入项：一句话简体中文项目 + 期望草案 schema 形状清单。
 *
 * `expectedRequiredInferredFields` 是 AIMarker 覆盖检查器的输入之一：
 * 定义 spec「必填推断字段清单」，任一字段缺失完整 marker 计一致性失败。
 * 每一项使用点分路径（如 `charter.startDate` / `tasks[].durationDays`）。
 */
export interface AiM0InputCase {
  id: string
  category: AiM0InputCategory
  sentence: string
  expectedRequiredInferredFields: string[]
  /** 对该类项目的额外期望（如「至少 3 个 WBS 顶层节点」），供后续 CI 扩展；POC 阶段可为空。 */
  expectationNotes?: string
}

/**
 * 一次生成结果的三档判定（spec 硬约束「按分布口径三档测量」）：
 * - `strict`：一次通过、零修复；
 * - `repaired`：经预清洗或轻量修复通过；
 * - `failed`：重试上限内仍不通过。
 */
export const AI_M0_CONSISTENCY_BUCKETS = ['strict', 'repaired', 'failed'] as const
export type AiM0ConsistencyBucket = (typeof AI_M0_CONSISTENCY_BUCKETS)[number]

/** 六类错误分类（design D6，spec 硬约束「六类错误均有恢复路径」）。 */
export const AI_M0_ERROR_KINDS = [
  'truncated',
  'malformed_json',
  'field_missing_or_type_error',
  'token_limit_exceeded',
  'sse_interrupted',
  'model_refusal_or_empty',
  /** 流式输出陷入原样重复循环，已中止请求（见 backend ai_m0/repetition_guard）。 */
  'repetition_loop',
] as const
export type AiM0ErrorKind = (typeof AI_M0_ERROR_KINDS)[number]

/** 单次生成的观测结果（送入统计器汇总）。 */
export interface AiM0GenerationOutcome {
  inputId: string
  strategy: AiM0Strategy
  bucket: AiM0ConsistencyBucket
  /** 首 token 到达延迟（ms），SSE 场景下等于第一 chunk 的 t0。 */
  firstTokenMs: number
  /** 完整生成延迟（ms）。 */
  totalMs: number
  /** 重试次数（0 = 一次成功）。 */
  retries: number
  /** 触发的错误分类（未触发即空数组）。 */
  triggeredErrors: AiM0ErrorKind[]
  /** 必填推断字段的 AIMarker 覆盖率（0..1）；<1 计一致性失败（spec 硬约束）。 */
  markerCoverage: number
  /** 用于成本报告的输出 token 估算（未知则 null）。 */
  outputTokens: number | null
}

/** 自助评测运行模式。dry_run 永远不能成为 M0 证据。 */
export const AI_M0_EVALUATION_MODES = ['dry_run', 'real'] as const
export type AiM0EvaluationMode = (typeof AI_M0_EVALUATION_MODES)[number]

export const AI_M0_STEP_STATUSES = ['pending', 'running', 'completed', 'failed'] as const
export type AiM0StepStatus = (typeof AI_M0_STEP_STATUSES)[number]

export const AI_M0_RUN_STATUSES = [
  'idle',
  'running',
  'pausing',
  'paused',
  'completed',
  'cancelled',
] as const
export type AiM0RunStatus = (typeof AI_M0_RUN_STATUSES)[number]

/** 可稳定重建的单个评测步骤。 */
export interface AiM0EvaluationStep {
  id: string
  inputId: string
  requestedStrategy: AiM0Strategy
  repetition: number
  status: AiM0StepStatus
  attempts: number
}

/** 单次评测的可追溯结果。 */
export interface AiM0EvaluationOutcome extends AiM0GenerationOutcome {
  stepId: string
  inputSetHash: string
  repetition: number
  requestedStrategy: AiM0Strategy
  effectiveStrategy: AiM0Strategy
  mode: AiM0EvaluationMode
  provider: string
  model: string
  connectionId: string | null
  usingRealAdapter: boolean
  evidenceEligible: boolean
  missingMarkerFields: string[]
  appliedFixes: string[]
  measuredAt: string
}

export interface AiM0StrategySummary {
  strategy: AiM0Strategy
  runs: number
  strict: number
  repaired: number
  failed: number
  landableRate: number
  markerCoverage: number
  firstTokenP50Ms: number
  firstTokenP95Ms: number
  totalP50Ms: number
  totalP95Ms: number
  retryRate: number
  evidenceEligible: boolean
  errors: Record<AiM0ErrorKind, number>
}

export interface AiM0EvaluationSummary {
  complete: boolean
  evidenceEligible: boolean
  total: number
  completed: number
  failed: number
  perStrategy: Record<AiM0Strategy, AiM0StrategySummary>
}

/** localStorage 中的版本化长任务文档；禁止添加 key、Authorization 或请求头。 */
export interface AiM0EvaluationRun {
  schemaVersion: 1
  id: string
  mode: AiM0EvaluationMode
  status: AiM0RunStatus
  connectionId: string | null
  inputSetHash: string
  repetitions: number
  temperature: number
  createdAt: string
  updatedAt: string
  steps: AiM0EvaluationStep[]
  outcomes: AiM0EvaluationOutcome[]
}

export interface AiM0StreamCheckpoint {
  schemaVersion: 1
  streamId: string
  requestFingerprint: string
  lastEventId: string
  rawText: string
  updatedAt: string
  finished: boolean
}

/**
 * 环境元数据：跟随每份 M0 报告一同结构化导出（spec「评测环境元数据完整」）。
 * 缺任一必备字段的报告不得作为门禁判定依据。
 */
export interface AiM0EnvironmentMetadata {
  provider: string
  model: string
  temperature: number
  repetitions: number
  measurementDate: string
  /** 评测输入集 hash（供跨运行核对）。 */
  inputSetHash: string
  /** 是否使用真实 Adapter；MockAdapter 时为 false，spec 禁止用于判定。 */
  usingRealAdapter: boolean
}

/**
 * M0 判定阈值（design D5 建议、apply 前置确认「预先固定为 design 建议值」）。
 * 三档汇总的最终可入库率 = strict + repaired；剩余由人工确认兜底。
 */
export const AI_M0_THRESHOLDS = {
  landableRate: 0.95,
  markerCoverage: 1,
  sseRecoveryRate: 0.95,
} as const
