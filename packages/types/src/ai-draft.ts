/**
 * ai-draft-generation / T036·T037 —— 生产级 AI 项目草案的前后端共享契约。
 *
 * 与 `ai-m0.ts`（POC 草案 `AiProjectDraft`，仅 4 模块，dev sandbox 专用）区分：
 * 本模块定义 V1 正式的 `ProjectDraft`，覆盖 spec 要求的 9 个模块
 * （charter/wbs/tasks/dependencies/acceptance/resource/risk/milestone/ganttPreview），
 * 且顶层 `dependencies` 携带 predecessor + successor，支持部分导入时的悬空依赖过滤。
 *
 * 纯静态类型 + const 数组，禁止依赖 zod / adonisjs（`@aiproj/types` 零依赖）。
 * 运行时权威校验（zod）在后端 `apps/backend/app/services/ai_draft/schema.ts` 定义，
 * 两侧共用本文件静态类型作为唯一 source-of-truth。
 */

import type { DraftDependencyType, DraftTaskStatus, Marked } from './ai-m0.js'
import type { ConfirmedProjectContext, ProjectPlanUnderstanding, ProjectType } from './ai-intent.js'

export const PROJECT_DRAFT_SCHEMA_VERSION = '1.0' as const

// ---------------------------------------------------------------------------
// 生成模块与结构化保证等级
// ---------------------------------------------------------------------------

/** 分步生成的模块键（design D2 顺序：charter → wbs → tasks/dependencies → acceptance → hints → ganttPreview）。 */
export const PROJECT_DRAFT_MODULES = [
  'charter',
  'wbs',
  'tasks',
  'dependencies',
  'acceptance',
  'resource',
  'risk',
  'milestone',
  'ganttPreview',
] as const
export type ProjectDraftModule = (typeof PROJECT_DRAFT_MODULES)[number]

export const PROJECT_DRAFT_MODULE_STATUSES = [
  'pending',
  'generating',
  'completed',
  'failed',
] as const
export type ProjectDraftModuleStatus = (typeof PROJECT_DRAFT_MODULE_STATUSES)[number]

/** 流式生成阶段（DraftGenerationRunner 驱动，低敏元数据禁止含 rawText/prompt/token）。 */
export const PROGRESS_PHASES = [
  'adapter_ready',
  'first_token',
  'receiving',
  'parsing',
  'validating',
  'retrying',
  'persisting',
] as const
export type ProgressPhase = (typeof PROGRESS_PHASES)[number]

/** 模块键 → 草案 JSON 字段名映射。类型约束保证覆盖 `PROJECT_DRAFT_MODULES` 全部 9 项。 */
export const MODULE_KEY_TO_JSON_FIELD: Record<ProjectDraftModule, string> = {
  charter: 'charter',
  wbs: 'wbs',
  tasks: 'tasks',
  dependencies: 'dependencies',
  acceptance: 'acceptanceCriteria',
  resource: 'resourceHints',
  risk: 'riskHints',
  milestone: 'milestoneHints',
  ganttPreview: 'ganttPreview',
} as const

/** 结构化输出策略（与网关能力探测一致，native > tool > prompt 降级）。 */
export const PROJECT_DRAFT_STRUCTURED_STRATEGIES = ['native', 'tool', 'prompt'] as const
export type ProjectDraftStructuredStrategy = (typeof PROJECT_DRAFT_STRUCTURED_STRATEGIES)[number]

/** 后端权威校验三档判定（strict = 一次通过；repairable = 轻量修复后通过；failed = 重试上限内不通过）。 */
export const PROJECT_DRAFT_CONSISTENCY = ['strict', 'repairable', 'failed'] as const
export type ProjectDraftConsistency = (typeof PROJECT_DRAFT_CONSISTENCY)[number]

/** 真实草案采用五段生成；每段只消费允许的上下文并最多看到两个工具。 */
export const PROJECT_DRAFT_GENERATION_STAGES = [
  'charter_scope',
  'wbs_tasks',
  'schedule_dependencies',
  'resources_risks_acceptance',
  'reconcile_review',
] as const
export type ProjectDraftGenerationStage = (typeof PROJECT_DRAFT_GENERATION_STAGES)[number]
export type ProjectDraftStage = ProjectDraftGenerationStage

export const PROJECT_DRAFT_CONFIRMABILITY_STATUSES = [
  'confirmable',
  'review_blocked',
  'failed',
] as const
export type ProjectDraftConfirmabilityStatus =
  (typeof PROJECT_DRAFT_CONFIRMABILITY_STATUSES)[number]

export interface GroundingManifestFact {
  id: string
  category:
    | 'domain'
    | 'role'
    | 'in_scope'
    | 'out_of_scope'
    | 'date'
    | 'metric'
    | 'deliverable'
    | 'business_concept'
  normalizedValue: string
  source: 'parsed' | 'confirmed' | 'assumption'
  required: boolean
  hash: string
}

/** 有界、可 hash 的已确认事实投影；禁止复制完整 rawInput。 */
export interface ProjectDraftGroundingManifest {
  version: '1.0'
  projectType: ProjectType
  facts: GroundingManifestFact[]
  hash: string
  truncated: boolean
}

export interface ProjectDraftStageArtifact {
  stage: ProjectDraftGenerationStage
  status: 'completed' | 'failed'
  contextScope: string[]
  allowedTools: string[]
  artifactHash: string | null
  attemptCount: number
  errorCodes: string[]
}

export interface ProjectDraftRepairEnvelope {
  version: '1.0'
  stage: ProjectDraftGenerationStage
  attempt: number
  errorCategories: Array<'provider' | 'parse' | 'schema' | 'grounding' | 'budget'>
  fieldPaths: string[]
  missingFactIds: string[]
  remainingAttempts: number
  requestFingerprint: string
  /** 脱敏的 JSON 解析失败类型（truncated/malformed_json/multi_object/bare_newline/illegal_quote 等），不含原始输出。 */
  parseErrorKinds?: string[]
}

/** 单阶段持久化 checkpoint：只保存已验证阶段产物与低敏元数据（无 prompt/rawText/token）。 */
export interface ProjectDraftStageCheckpoint {
  version: '1.0'
  stage: ProjectDraftGenerationStage
  status: 'completed' | 'failed'
  /** 已验证的阶段产物（normalized 字段子集）；failed 阶段为 null。 */
  artifact: Record<string, unknown> | null
  artifactHash: string | null
  manifestHash: string
  catalogVersion: string
  guideVersion: string
  schemaVersion: typeof PROJECT_DRAFT_SCHEMA_VERSION
  provider: string
  model: string
  strategy: ProjectDraftStructuredStrategy
  attemptCount: number
  errorCodes: string[]
  /** 该阶段实际消耗的墙钟毫秒（失败阶段也记录，用于恢复时继承预算）。 */
  spentMs: number
  /** 脱敏解析错误类型（不含原始输出）。 */
  parseErrorKinds: string[]
  validationResult: { ok: boolean; errors: DraftSchemaError[] } | null
}

/** 全流程断点快照：重试时据此从失败阶段继续，不重新生成已通过的章程/WBS。 */
export interface ProjectDraftPipelineCheckpoint {
  version: '1.0'
  /** 上下文指纹（groundingManifest.hash）；变化即整体失效。 */
  contextHash: string
  completedStages: ProjectDraftStageCheckpoint[]
  /** 最近一次失败的阶段（含 attemptCount/parseErrorKinds/校验结果），用于重试时知情续跑。 */
  failedStage?: ProjectDraftStageCheckpoint | null
  /** 已消耗的全局墙钟毫秒（恢复时继承，避免重试获得全新 6 分钟）。 */
  spentMs: number
  /** 已消耗的全局响应字符预算。 */
  spentChars: number
  /** 生成开始时产出（或用户确认）的项目理解；续跑时复用，不重新生成。 */
  planUnderstanding?: ProjectPlanUnderstanding
}

export interface ProjectDraftConfirmability {
  status: ProjectDraftConfirmabilityStatus
  reasons: string[]
}

export interface ProjectDraftProvenance {
  requestedStrategy: ProjectDraftStructuredStrategy
  effectiveStrategy: ProjectDraftStructuredStrategy
  requestedModel: string
  responseModel: string
  provider: string
  fallbackUsed: boolean
}

// ---------------------------------------------------------------------------
// 质量/来源投影的有界序列化与脱敏（task 1.2 共享契约）
// ---------------------------------------------------------------------------

export const PROJECT_DRAFT_QUALITY_LIMITS = {
  maxGroundingFacts: 32,
  maxStages: 5,
  maxAllowedTools: 2,
  maxRepairFieldPaths: 20,
  maxQualityReasons: 10,
  maxHashLength: 64,
} as const

const PROJECT_DRAFT_SENSITIVE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/(?:bearer\s+)?sk-[a-z0-9_-]{12,}/giu, '[REDACTED_SECRET]'],
  [/authorization\s*[:=]\s*(?:bearer\s+)?[^\s]+/giu, '[REDACTED_AUTH]'],
  [/bearer\s+[^\s]+/giu, '[REDACTED_AUTH]'],
  [/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[REDACTED_EMAIL]'],
]

/** 对质量投影允许出现的自由文本做确定性脱敏。 */
export function redactProjectDraftQualityText(value: string): string {
  let result = value
  for (const [pattern, replacement] of PROJECT_DRAFT_SENSITIVE_REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/** 脱敏 grounding manifest 的可读字段；保留稳定 ID 与 hash。 */
export function redactGroundingManifest(
  manifest: ProjectDraftGroundingManifest,
): ProjectDraftGroundingManifest {
  return {
    ...manifest,
    facts: manifest.facts.map((fact) => ({
      ...fact,
      normalizedValue: redactProjectDraftQualityText(fact.normalizedValue),
    })),
  }
}

/** 脱敏 repair envelope 的字段路径与 fact ID 之外可能含敏感值的字段。 */
export function redactRepairEnvelope(
  envelope: ProjectDraftRepairEnvelope,
): ProjectDraftRepairEnvelope {
  return { ...envelope }
}

function projectDraftStableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(projectDraftStableStringify).join(',') + ']'
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return (
      '{' +
      keys
        .map((key) => JSON.stringify(key) + ':' + projectDraftStableStringify(record[key]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value ?? null)
}

/** 有界确定性序列化，供审计与质量 hash 使用。 */
export function serializeProjectDraftGroundingManifest(
  manifest: ProjectDraftGroundingManifest,
): string {
  const bounded: ProjectDraftGroundingManifest = {
    ...redactGroundingManifest(manifest),
    facts: redactGroundingManifest(manifest).facts.slice(
      0,
      PROJECT_DRAFT_QUALITY_LIMITS.maxGroundingFacts,
    ),
  }
  return projectDraftStableStringify(bounded)
}

/** 错误项结构（低敏错误摘要，不含 prompt/密钥/完整模型输出）。 */
export interface ProjectDraftFailureError {
  path?: string
  message: string
  code?: string
}

/** 草案失败终态结构化详情。 */
export interface ProjectDraftFailureDetail {
  errorCode: string
  message: string
  consistency: ProjectDraftConsistency
  sequence: number
  stage?: ProjectDraftGenerationStage
  reasonCode?: string
  errors?: ProjectDraftFailureError[]
}

/** 对失败详情及其包含的错误信息做确定性脱敏。 */
export function redactProjectDraftFailureDetail(
  detail: ProjectDraftFailureDetail,
): ProjectDraftFailureDetail {
  return {
    ...detail,
    message: redactProjectDraftQualityText(detail.message),
    errors: detail.errors?.map((err) => ({
      ...err,
      message: redactProjectDraftQualityText(err.message),
      path: err.path ? redactProjectDraftQualityText(err.path) : undefined,
    })),
  }
}

/** 有界确定性序列化失败详情，保证脱敏且无 prompt/key 泄露。 */
export function serializeProjectDraftFailureDetail(detail: ProjectDraftFailureDetail): string {
  const redacted = redactProjectDraftFailureDetail(detail)
  return projectDraftStableStringify(redacted)
}

/** 纯函数 hash，不依赖 Node crypto，可在浏览器与后端共用。 */
export function computeProjectDraftQualityHash(value: unknown): string {
  let hash = 0x811c9dc5
  const text = projectDraftStableStringify(value)
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0)
    .toString(16)
    .padStart(8, '0')
    .slice(0, PROJECT_DRAFT_QUALITY_LIMITS.maxHashLength)
}

// ---------------------------------------------------------------------------
// 草案子结构（所有 AI 推断字段带 AIMarker；高影响字段 needsConfirmation 强制 true）
// ---------------------------------------------------------------------------

/** 项目章程。所有字段都是 AI 推断，均需 AIMarker。 */
export interface ProjectDraftCharter {
  title: Marked<string>
  vision: Marked<string>
  scope: Marked<string>
  objectives: Marked<string[]>
  successCriteria: Marked<string[]>
  startDate: Marked<string>
  endDate: Marked<string>
}

/** WBS 节点（任意层级树）。`isNote` 叶节点为纯说明节点，无需关联任务。 */
export interface ProjectDraftWbsNode {
  id: string
  parentId: string | null
  outlineCode: string
  name: Marked<string>
  description: Marked<string>
  isLeaf: boolean
  isNote: boolean
  children: ProjectDraftWbsNode[]
}

/** 任务：挂在 WBS 叶节点下的可执行工作项。日期/工期/负责人为高影响推断。 */
export interface ProjectDraftTask {
  id: string
  wbsNodeId: string
  name: Marked<string>
  description: Marked<string>
  status: DraftTaskStatus
  durationDays: Marked<number>
  startDate: Marked<string>
  endDate: Marked<string>
  assigneeHint: Marked<string>
  /** 草案期稳定负责人角色 ID 列表（如 ['app-dev','ops']）；缺失时由 assigneeHint 分段推导。 */
  assigneeRoleIds?: Marked<string[]>
  /** 三点估算（工作日）：乐观 ≤ durationDays（最可能）≤ 悲观；缺失时按任务类别默认系数推导。 */
  estimate?: ProjectDraftTaskEstimate
  /**
   * 同时投入该任务的人数（普通数字，缺省 1）：多人并行做同一项工作时由模型标注，
   * 资源平衡按此占用角色容量，产能利用率按 durationDays × headcount 折算人天。
   */
  headcount?: number
  /** 可执行说明（任务翻译器产物）：拿到任务的人不用再问就能开工。 */
  execution?: ProjectDraftTaskExecution
  /** 来源追溯：任务由哪项能力的哪个工作包拆出（拆解层产物）。 */
  trace?: ProjectDraftTaskTrace
}

export interface ProjectDraftTaskTrace {
  capabilityId: string
  capabilityName: string
  workPackageId: string
  workPackageName: string
}

/** 拆解层：能力 → 工作包（WBS 一级 = 能力，二级 = 工作包，由程序据此构建）。 */
export interface ProjectDraftWorkPackage {
  id: string
  capabilityId: string
  name: string
  /** 可验收的交付物。 */
  deliverable: string
  /** 怎样算这个工作包做完。 */
  doneDefinition: string
  /** 同能力内或其它能力的前置工作包 id。 */
  dependsOn: string[]
  /** 粗估工作量（人天）。 */
  effortDays: number
  /** 各角色投入（人天），角色名取自团队名册；用于按角色核对容量。 */
  roleEffort?: Record<string, number>
}

export interface ProjectDraftDecomposition {
  capabilities: Array<{ id: string; name: string; wbsNodeId: string }>
  workPackages: Array<ProjectDraftWorkPackage & { wbsNodeId: string }>
  /** 多候选：每项能力生成的候选数与评审选择说明。 */
  candidateReviews: Array<{ capabilityId: string; candidates: number; verdict: string }>
}

/** 生成过程中的关键决定（记忆系统的决策库）：后续调用不得推翻，审查页可见。 */
export interface ProjectDraftDecision {
  id: string
  /** 决定了什么。 */
  decision: string
  /** 为什么。 */
  reason: string
  source: 'user' | 'system' | 'model'
  stage: string
}

/**
 * 任务可执行标准：为什么做、需要什么输入、产出什么、怎样算完成、分几步做、谁验收。
 * 计划层任务 1–5 个工作日，steps 是任务内部清单（每步约半天）。
 */
export interface ProjectDraftTaskExecution {
  purpose: string
  inputs: string[]
  outputs: string[]
  doneCriteria: string[]
  steps: string[]
  reviewerRole?: string
}

/** 生成管线自修复后仍需人工判断的事项（只有这些才出现在审查页「待你确认」）。 */
export const PROJECT_DRAFT_REVIEW_ITEM_KINDS = [
  'assumption',
  'decision_needed',
  'unresolved_issue',
] as const
export type ProjectDraftReviewItemKind = (typeof PROJECT_DRAFT_REVIEW_ITEM_KINDS)[number]

export interface ProjectDraftReviewItem {
  id: string
  kind: ProjectDraftReviewItemKind
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
  taskIds?: string[]
  /** 系统已尝试的自动修复轮次（0 表示本就需要人判断）。 */
  attemptedRepairs: number
}

/** 质量闭环记录：批判 → 单点修复 → 复查的轮次与效果。 */
export interface ProjectDraftQualityLoop {
  rounds: number
  issuesBefore: number
  issuesAfter: number
  repairedTasks: number
  addedDependencies: number
  modelCalls: number
  /** 按问题类别的剩余数量。 */
  remainingByKind: Record<string, number>
}

/** 单次模型调用的上下文用量（上下文隔离的可观测证据）。 */
export interface ProjectDraftContextUsage {
  call: string
  inputChars: number
  /** 注入的记忆片段名（spine / wbsOutline / taskIndex …）。 */
  memorySlices: string[]
}

export interface ProjectDraftTaskEstimate {
  optimisticDays: number
  pessimisticDays: number
}

/** 顶层任务依赖（predecessor → successor），部分导入时按选择集过滤悬空边。 */
export interface ProjectDraftDependency {
  id: string
  predecessorId: string
  successorId: string
  type: DraftDependencyType
  lagDays: Marked<number>
}

/** 验收标准。可选关联到任务或 charter.successCriteria 索引。 */
export interface ProjectDraftAcceptanceCriterion {
  id: string
  statement: Marked<string>
  linkedTaskId: string | null
  linkedSuccessIndex: number | null
}

/** 基础资源建议（角色 + 人数 + 分配说明）。 */
export interface ProjectDraftResourceHint {
  id: string
  role: Marked<string>
  headcount: Marked<number>
  allocationNote: Marked<string>
}

export const PROJECT_DRAFT_RISK_LEVELS = ['low', 'medium', 'high'] as const
export type ProjectDraftRiskLevel = (typeof PROJECT_DRAFT_RISK_LEVELS)[number]

/** 基础风险建议。风险等级为高影响推断，needsConfirmation 强制 true。 */
export const PROJECT_DRAFT_RISK_STRATEGIES = ['avoid', 'transfer', 'mitigate', 'accept'] as const
export type ProjectDraftRiskStrategy = (typeof PROJECT_DRAFT_RISK_STRATEGIES)[number]

export interface ProjectDraftRiskHint {
  id: string
  description: Marked<string>
  level: Marked<ProjectDraftRiskLevel>
  mitigation: Marked<string>
  /** 风险登记册扩展（可选，兼容旧草案）：触发条件、责任角色、应对策略类型。 */
  trigger?: Marked<string>
  ownerRole?: Marked<string>
  strategy?: Marked<ProjectDraftRiskStrategy>
}

/** 里程碑建议。目标日期为高影响推断。 */
export interface ProjectDraftMilestoneHint {
  id: string
  name: Marked<string>
  targetDate: Marked<string>
  linkedTaskIds: string[]
}

/** 甘特图预览摘要：供前端快速展示整体排期，不落库正式甘特数据。 */
export interface ProjectDraftGanttPreview {
  startDate: Marked<string>
  endDate: Marked<string>
  totalDurationDays: Marked<number>
  criticalPathTaskIds: string[]
  phaseCount: number
}

/** 顶层草案文档（9 模块）。所有可导入字段带稳定临时 ID。 */
export interface ProjectDraft {
  schemaVersion: typeof PROJECT_DRAFT_SCHEMA_VERSION
  projectType: ProjectType
  charter: ProjectDraftCharter
  wbs: ProjectDraftWbsNode[]
  tasks: ProjectDraftTask[]
  dependencies: ProjectDraftDependency[]
  acceptanceCriteria: ProjectDraftAcceptanceCriterion[]
  resourceHints: ProjectDraftResourceHint[]
  riskHints: ProjectDraftRiskHint[]
  milestoneHints: ProjectDraftMilestoneHint[]
  ganttPreview: ProjectDraftGanttPreview
  /** 治理文档（可选，兼容旧草案）：RACI、质量门准入准出、投产窗口计划。 */
  governance?: ProjectDraftGovernance
}

export interface ProjectDraftRaciEntry {
  /** 活动 / 交付物名称。 */
  activity: string
  responsible: string[]
  accountable: string
  consulted: string[]
  informed: string[]
}

export interface ProjectDraftQualityGate {
  /** 如 SIT、UAT、等保测评、投产评审。 */
  name: string
  entryCriteria: string[]
  exitCriteria: string[]
}

export interface ProjectDraftReleaseWindow {
  name: string
  startDate: string
  endDate: string
  scope: string
  rollbackPlan: string
}

export interface ProjectDraftGovernance {
  raci: ProjectDraftRaciEntry[]
  qualityGates: ProjectDraftQualityGate[]
  releaseWindows: ProjectDraftReleaseWindow[]
}

// ---------------------------------------------------------------------------
// 计划体检（确定性推导，写入 meta.planInsights，供审查页展示与导入使用）
// ---------------------------------------------------------------------------

export interface ProjectDraftPlanInsights {
  version: '1.0'
  workCalendar: {
    officialYears: number[]
    estimatedYears: number[]
    /** 项目窗口内的放假 / 调休日。 */
    days: Array<{ date: string; name: string; work: boolean; estimated: boolean }>
    changeFreezeWindows: Array<{ start: string; end: string; label: string }>
    /** 落在封网窗口内的投产类任务 id（应为空）。 */
    productionTasksInFreeze: string[]
    /** 与封网窗口重叠的投产窗口名称（应为空）。 */
    releaseWindowsInFreeze: string[]
  }
  capacity: {
    startDate: string | null
    endDate: string | null
    workingDays: number
    availablePersonDays: number
    requiredPersonDays: number
    /** required / available；> 1 表示团队人天不足。 */
    utilization: number
    byRole: Array<{
      role: string
      headcount: number
      availablePersonDays: number
      requiredPersonDays: number
      utilization: number
    }>
  }
  scheduleConfidence: {
    method: 'pert_monte_carlo'
    samples: number
    deterministicEndDate: string | null
    p50EndDate: string | null
    p80EndDate: string | null
    p90EndDate: string | null
    deadline: string | null
    /** 按期完成概率（0..1）；无截止日时为 null。 */
    onTimeProbability: number | null
    /** 使用模型给出三点估算的任务占比；其余按任务类别默认系数。 */
    explicitEstimateRatio: number
  }
  stageGates: {
    template: string
    gates: Array<{ key: string; name: string; present: boolean; matchedNodeIds: string[] }>
    missing: string[]
  }
  traceability: {
    deliverables: Array<{
      deliverable: string
      wbsNodeIds: string[]
      taskIds: string[]
      acceptanceIds: string[]
      milestoneIds: string[]
      complete: boolean
    }>
    /** 无法追溯到任何交付物的任务（管理 / 质量保障类除外）。 */
    untracedTaskIds: string[]
    /** 交付物四段链路全部完整的比例。 */
    coverage: number
  }
  /**
   * 参照类对比（v3-llm-wiki-planning-dossier）：工期超过本组织同类任务实际 P80 的草案任务。
   * 只提示、不阻断；草案上下文没有参照类时缺省。
   */
  referenceClass?: {
    label: string
    samples: number
    p50Days: number
    p80Days: number
    longTasks: Array<{ id: string; name: string; durationDays: number }>
  }
  /**
   * 流程实况（v3-llm-wiki-process-reality）：按本组织实际流转给出的提示句与工期短于审批实际等待 P80 的审批类任务。
   * 只提示、不阻断；没有可提示的内容时缺省。
   */
  processReality?: {
    notes: string[]
    approvalTasks: Array<{ id: string; name: string; durationDays: number }>
  }
  /**
   * 历史教训（v3-llm-wiki-retrospective-lessons）：组织教训库里与本草案相关的教训，只提示、不阻断；没有时缺省。
   */
  lessons?: Array<{ statement: string; section: string | null }>
}

/** 生成元数据：结构化策略、三档判定、fallback 与修复摘要（供审计与审查面板展示保证等级）。 */
export interface ProjectDraftMeta {
  schemaVersion: typeof PROJECT_DRAFT_SCHEMA_VERSION
  projectType: ProjectType
  structuredStrategy: ProjectDraftStructuredStrategy
  consistency: ProjectDraftConsistency
  fallbackUsed: boolean
  provider: string
  model: string
  usingRealAdapter: boolean
  appliedFixes: string[]
  moduleCounts: ProjectDraftModuleCounts
  /** 新字段均为可选，允许读取既有草案版本。 */
  groundingManifest?: ProjectDraftGroundingManifest
  /** 计划体检（日历 / 产能 / 置信区间 / 阶段门 / 追溯链），确定性推导。 */
  planInsights?: ProjectDraftPlanInsights
  stages?: ProjectDraftStageArtifact[]
  confirmability?: ProjectDraftConfirmability
  provenance?: ProjectDraftProvenance
  repairs?: ProjectDraftRepairEnvelope[]
  /** 生成所依据的项目理解（含用户是否确认）。 */
  planUnderstanding?: ProjectPlanUnderstanding
  reviewItems?: ProjectDraftReviewItem[]
  qualityLoop?: ProjectDraftQualityLoop
  contextUsage?: ProjectDraftContextUsage[]
  decomposition?: ProjectDraftDecomposition
  decisions?: ProjectDraftDecision[]
  failure?: {
    stage?: ProjectDraftGenerationStage
    reasonCode?: string
    errors?: ProjectDraftFailureError[]
  }
}

/** 各模块计数（进审计元数据，不含正文）。 */
export interface ProjectDraftModuleCounts {
  wbsNodes: number
  tasks: number
  dependencies: number
  acceptanceCriteria: number
  resourceHints: number
  riskHints: number
  milestoneHints: number
}

// ---------------------------------------------------------------------------
// 后端 schema 校验错误（字段路径可定位）
// ---------------------------------------------------------------------------

/** 单条 schema 校验错误，`path` 为点分/括号路径（如 `tasks[2].durationDays`）。 */
export interface DraftSchemaError {
  path: string
  message: string
}

// ---------------------------------------------------------------------------
// T038 反幻觉 / 转换校验契约（本变更只定义并调用，规则实现由独立 change 交付）
// ---------------------------------------------------------------------------

export const DRAFT_VALIDATION_SEVERITIES = ['blocking', 'warning', 'info'] as const
export type DraftValidationSeverity = (typeof DRAFT_VALIDATION_SEVERITIES)[number]

export const DRAFT_OVERALL_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type DraftOverallRiskLevel = (typeof DRAFT_OVERALL_RISK_LEVELS)[number]

export const DRAFT_VALIDATION_PHASES = ['self_checking', 'validating'] as const
export type DraftValidationPhase = (typeof DRAFT_VALIDATION_PHASES)[number]

export const DRAFT_VALIDATION_DIMENSIONS = [
  'factualAccuracy',
  'logicalConsistency',
  'assumptionClarity',
  'completeness',
  'numericPlausibility',
] as const
export type DraftValidationDimension = (typeof DRAFT_VALIDATION_DIMENSIONS)[number]

export const DRAFT_VALIDATION_DIMENSION_WEIGHTS = {
  factualAccuracy: 0.3,
  logicalConsistency: 0.25,
  assumptionClarity: 0.2,
  completeness: 0.1,
  numericPlausibility: 0.15,
} as const satisfies Record<DraftValidationDimension, number>

export const DRAFT_HALLUCINATION_RULE_IDS = [
  'HL-001',
  'HL-002',
  'HL-003',
  'HL-004',
  'HL-005',
  'HL-006',
  'HL-007',
  'HL-008',
  'HL-009',
  'HL-010',
] as const
export type DraftHallucinationRuleId = (typeof DRAFT_HALLUCINATION_RULE_IDS)[number]

export const DRAFT_VALIDATION_ENGINE_RULE_IDS = [
  'VE-001',
  'VE-002',
  'VE-003',
  'VE-004',
  'VE-005',
  'VE-006',
  'VE-007',
  'VE-008',
  'VE-009',
  'VE-010',
  'VE-011',
  'VE-012',
] as const
export type DraftValidationEngineRuleId = (typeof DRAFT_VALIDATION_ENGINE_RULE_IDS)[number]
export type DraftValidationRuleId = DraftHallucinationRuleId | DraftValidationEngineRuleId

export const DRAFT_VALIDATION_RULE_IDS = [
  ...DRAFT_HALLUCINATION_RULE_IDS,
  ...DRAFT_VALIDATION_ENGINE_RULE_IDS,
] as const

export const DRAFT_VALIDATION_RULE_SEVERITY = {
  'HL-001': 'blocking',
  'HL-002': 'blocking',
  'HL-003': 'blocking',
  'HL-004': 'warning',
  'HL-005': 'info',
  'HL-006': 'blocking',
  'HL-007': 'blocking',
  'HL-008': 'blocking',
  'HL-009': 'warning',
  'HL-010': 'warning',
  'VE-001': 'blocking',
  'VE-002': 'blocking',
  'VE-003': 'warning',
  'VE-004': 'warning',
  'VE-005': 'info',
  'VE-006': 'warning',
  'VE-007': 'warning',
  'VE-008': 'info',
  'VE-009': 'info',
  'VE-010': 'blocking',
  'VE-011': 'info',
  'VE-012': 'info',
} as const satisfies Record<DraftValidationRuleId, DraftValidationSeverity>

export const DRAFT_VALIDATION_RULE_AUTO_FIXABLE = {
  'HL-001': false,
  'HL-002': true,
  'HL-003': false,
  'HL-004': true,
  'HL-005': false,
  'HL-006': true,
  'HL-007': true,
  'HL-008': true,
  'HL-009': true,
  'HL-010': false,
  'VE-001': false,
  'VE-002': false,
  'VE-003': false,
  'VE-004': false,
  'VE-005': false,
  'VE-006': false,
  'VE-007': false,
  'VE-008': false,
  'VE-009': false,
  'VE-010': false,
  'VE-011': false,
  'VE-012': false,
} as const satisfies Record<DraftValidationRuleId, boolean>

export const DRAFT_VALIDATION_RULE_DIMENSION = {
  'HL-001': 'factualAccuracy',
  'HL-002': 'numericPlausibility',
  'HL-003': 'logicalConsistency',
  'HL-004': 'assumptionClarity',
  'HL-005': 'factualAccuracy',
  'HL-006': 'numericPlausibility',
  'HL-007': 'logicalConsistency',
  'HL-008': 'numericPlausibility',
  'HL-009': 'assumptionClarity',
  'HL-010': 'assumptionClarity',
  'VE-001': 'numericPlausibility',
  'VE-002': 'logicalConsistency',
  'VE-003': 'numericPlausibility',
  'VE-004': 'completeness',
  'VE-005': 'completeness',
  'VE-006': 'numericPlausibility',
  'VE-007': 'completeness',
  'VE-008': 'numericPlausibility',
  'VE-009': 'logicalConsistency',
  'VE-010': 'completeness',
  'VE-011': 'logicalConsistency',
  'VE-012': 'logicalConsistency',
} as const satisfies Record<DraftValidationRuleId, DraftValidationDimension>

export const DRAFT_VALIDATION_RULE_PHASE = Object.fromEntries(
  DRAFT_VALIDATION_RULE_IDS.map((ruleId) => [
    ruleId,
    ruleId.startsWith('HL-') ? 'self_checking' : 'validating',
  ]),
) as Record<DraftValidationRuleId, DraftValidationPhase>

/** 单条校验结果，`ruleId` 兼容 HL-001~HL-010 / VE-001~VE-012 或结构性占位码。 */
export interface DraftValidationIssue {
  ruleId: DraftValidationRuleId | string
  severity: DraftValidationSeverity
  message: string
  path: string | null
  autoFixable?: boolean
  dimension?: DraftValidationDimension
  failed?: boolean
}

/** 自动修正差异：只作用于草案版本，需用户重新确认。 */
export interface DraftAutoFixDiff {
  path: string
  before: unknown
  after: unknown
  reason: string
}

/**
 * 校验报告（T038 对外契约）。
 * `canConfirm` = 无 blocking 项（warning 需用户显式确认，不影响本字段）。
 */
export interface DraftValidationReport {
  overallRiskLevel: DraftOverallRiskLevel
  confidenceScore: number
  dimensionScores: Record<DraftValidationDimension, number>
  blocking: DraftValidationIssue[]
  warning: DraftValidationIssue[]
  info: DraftValidationIssue[]
  ruleResults: DraftValidationIssue[]
  autoFixDiffs: DraftAutoFixDiff[]
  canConfirm: boolean
}

// ---------------------------------------------------------------------------
// SSE 事件（UI 状态来源，非正式数据来源；前端按 sequence 幂等合并）
// ---------------------------------------------------------------------------

export const PROJECT_DRAFT_EVENT_TYPES = [
  'draft.started',
  'module.delta',
  'module.completed',
  'draft.progress',
  'draft.heartbeat',
  'generation.output',
  'validation.warning',
  'draft.completed',
  'draft.failed',
] as const

/** 输出事件批量阈值：每累积约 N 字符发一条 generation.output（对齐 draft.progress 降频惯例）。 */
export const GENERATION_OUTPUT_FLUSH_CHARS = 96
export type ProjectDraftEventType = (typeof PROJECT_DRAFT_EVENT_TYPES)[number]

export interface ProjectDraftEventBase {
  type: ProjectDraftEventType
  draftId: string
  version: number
  sequence: number
}

export interface DraftStartedEvent extends ProjectDraftEventBase {
  type: 'draft.started'
  projectType: ProjectType
  modules: ProjectDraftModule[]
}

export interface DraftModuleDeltaEvent extends ProjectDraftEventBase {
  type: 'module.delta'
  module: ProjectDraftModule
  status: ProjectDraftModuleStatus
}

export interface DraftModuleCompletedEvent extends ProjectDraftEventBase {
  type: 'module.completed'
  module: ProjectDraftModule
}

export interface DraftValidationWarningEvent extends ProjectDraftEventBase {
  type: 'validation.warning'
  issues: DraftValidationIssue[]
}

export interface DraftCompletedEvent extends ProjectDraftEventBase {
  type: 'draft.completed'
  draft: ProjectDraft
  meta: ProjectDraftMeta
  validation: DraftValidationReport
}

export interface DraftFailedEvent extends ProjectDraftEventBase {
  type: 'draft.failed'
  errorCode: string
  message: string
  consistency: ProjectDraftConsistency
  stage?: ProjectDraftGenerationStage
  reasonCode?: string
  errors?: ProjectDraftFailureError[]
}

/** 生成阶段事件：只含低敏元数据，禁止 rawText/prompt/token。 */
export interface DraftProgressEvent extends ProjectDraftEventBase {
  type: 'draft.progress'
  phase: ProgressPhase
  receivedChars: number
  attempt?: number
}

/**
 * 模型真实输出片段事件（AI 一键生成实时输出面板）。
 * 瞬时观察通道：只经 runner 内存队列实时广播，不落库、不进 events 回放；
 * `sequence` 恒为 0，不参与语义序列连续性，不推进恢复 cursor。
 */
export interface GenerationOutputEvent extends ProjectDraftEventBase {
  type: 'generation.output'
  text: string
  /** 模型调用编号：并发调用各自一条输出流，前端按它分道展示。 */
  callId?: string
  /** 这次调用在做什么（面向用户的步骤名，如「拆解工作包：会员账户」）。 */
  label?: string
  /** 该调用输出结束。 */
  done?: boolean
  /** reasoning = 推理模型的思考过程（不是草案正文）；缺省为正文。 */
  kind?: 'reasoning'
  /** 这次调用的模型名（开道时带上）。 */
  model?: string
}

/** 连接活性心跳：生成静默期持续发出，不落库。 */
export interface DraftHeartbeatEvent extends ProjectDraftEventBase {
  type: 'draft.heartbeat'
  elapsedMs: number
}

export type ProjectDraftStreamEvent =
  | DraftStartedEvent
  | DraftModuleDeltaEvent
  | DraftModuleCompletedEvent
  | DraftProgressEvent
  | DraftHeartbeatEvent
  | GenerationOutputEvent
  | DraftValidationWarningEvent
  | DraftCompletedEvent
  | DraftFailedEvent

// ---------------------------------------------------------------------------
// 会话状态、选择集与确认请求
// ---------------------------------------------------------------------------

/** 前端草案工作台状态机（design D4 / 迁移计划）。 */
export const PROJECT_DRAFT_SESSION_STATUSES = [
  'drafting',
  'reviewing',
  'editing',
  'applying',
  'confirmed',
  'saved',
  'rejected',
  'error',
] as const
export type ProjectDraftSessionStatus = (typeof PROJECT_DRAFT_SESSION_STATUSES)[number]

export const DRAFT_CONFIRM_MODES = ['all', 'partial'] as const
export type DraftConfirmMode = (typeof DRAFT_CONFIRM_MODES)[number]

/** 未选内容处理策略。 */
export const DRAFT_UNSELECTED_STRATEGIES = ['discard', 'save_as_draft', 'ask_later'] as const
export type DraftUnselectedStrategy = (typeof DRAFT_UNSELECTED_STRATEGIES)[number]

/** 部分接受选择集（临时 ID 引用草案内元素）。 */
export interface ProjectDraftSelection {
  taskIds: string[]
  wbsNodeIds: string[]
  acceptanceIds: string[]
  milestoneIds: string[]
  riskHintIds: string[]
  unselectedStrategy: DraftUnselectedStrategy
}

/** 字段级修改。`path` 为点分/括号路径（如 `tasks[t3].durationDays`、`charter.startDate`）。 */
export interface ProjectDraftModification {
  path: string
  value: string | number | boolean | string[]
}

/** 生成请求：只接受版本化、branch=ready 的 ConfirmedProjectContext。 */
export interface GenerateProjectDraftRequest {
  context: ConfirmedProjectContext
  connectionId?: number
  modelId?: number
}

/** 确认导入请求。`acknowledgedWarnings` 为 true 表示用户已显式确认 warning 项。 */
export interface ConfirmProjectDraftRequest {
  version: number
  mode: DraftConfirmMode
  selection?: ProjectDraftSelection
  modifications?: ProjectDraftModification[]
  acknowledgedWarnings: boolean
  /** 审查页的人员分配：草案角色 → 组织成员 userId；导入时按角色负载均衡把任务指派给真人。 */
  roleAssignments?: Array<{ role: string; userIds: number[] }>
  /**
   * 转正发起方式（缺省 = user）：ai_colleague_autopilot = 用户在 AI 同事里明确选择「全自动（包括转为
   * 正式项目）」后由 AI 同事代为确认；服务端照常校验阻断项，审计记为「由 AI 同事全自动转正」。
   */
  confirmedVia?: 'user' | 'ai_colleague_autopilot'
}

/** 导入创建的正式数据计数。 */
export interface DraftImportCounts {
  wbsNodes: number
  tasks: number
  dependencies: number
  milestones: number
  acceptanceCriteria: number
  risks: number
}

export interface ConfirmProjectDraftResponse {
  projectId: number
  createdCounts: DraftImportCounts
}

export interface ValidateProjectDraftRequest {
  phase?: DraftValidationPhase | 'all'
  selection?: ProjectDraftSelection
  autoFix?: boolean
  /** 可选的就地编辑（复用确认请求的 modifications 类型）：服务端先应用修改再校验。 */
  modifications?: ProjectDraftModification[]
}

export interface ValidateProjectDraftResponse {
  version: number
  report: DraftValidationReport
  autoFixDiffs: DraftAutoFixDiff[]
}

/** AI 同事全自动修正阻断项（`POST /ai/project-drafts/:id/ai-fix`；只改字段时零写入，结构性操作落新草案版本）。 */
export interface AiFixProjectDraftRequest {
  /** 之前几轮已经采纳的修改（在此基础上继续修）。 */
  modifications?: ProjectDraftModification[]
  /** 调用方手上的草案版本（与活动版本不一致时服务端拒绝）。 */
  version?: number
  connectionId?: number
  modelId?: number
}

/** 全自动修正的结构性操作（增删任务 / 依赖，删除里程碑 / 验收条目）。 */
export interface AiFixDraftOperation {
  op:
    | 'add_task'
    | 'remove_task'
    | 'add_dependency'
    | 'remove_dependency'
    | 'remove_milestone'
    | 'remove_acceptance'
  [key: string]: unknown
}

export interface AiFixProjectDraftResponse {
  version: number
  /** 合并后的全部修改（确认时整体带上）。 */
  modifications: ProjectDraftModification[]
  /** 本轮模型新提出的修改。 */
  applied: ProjectDraftModification[]
  /** 本轮采纳的结构性操作；非空时服务端已落新草案版本（version 变大，modifications 为空）。 */
  operations: AiFixDraftOperation[]
  reasons: string[]
  /** 带着全部修改重算的校验报告。 */
  report: DraftValidationReport
  model: string | null
  /** 没有可用的真实模型。 */
  unavailable?: boolean
}

/** 草案详情（GET /:id 与断点恢复）。 */
export interface ProjectDraftDetail {
  draftId: string
  version: number
  status: ProjectDraftSessionStatus
  /** drafting 但无进程内 runner 时标记 orphaned，供恢复 UI 给出显式重试。 */
  generationState: 'running' | 'orphaned' | 'settled'
  projectType: ProjectType
  draft: ProjectDraft | null
  meta: ProjectDraftMeta | null
  validation: DraftValidationReport | null
  events: ProjectDraftStreamEvent[]
  /**
   * 已落库的失败终态摘要。断线/刷新后 UI 必须以它恢复失败状态，不能把 error
   * 会话误显示成“仍在准备审查数据”。正文、prompt 与 provider 原始错误不进入此字段。
   */
  failure?: ProjectDraftFailureDetail | null
}

// ---------------------------------------------------------------------------
// AIMarker 覆盖检查：高影响字段清单（缺 marker → schema 校验失败）
// ---------------------------------------------------------------------------

/**
 * 高影响推断字段点分路径模板。校验器对这些路径强制要求 AIMarker.needsConfirmation === true。
 * `[]` 表示数组每一项。
 */
export const PROJECT_DRAFT_HIGH_IMPACT_FIELDS = [
  'charter.startDate',
  'charter.endDate',
  'tasks[].durationDays',
  'tasks[].startDate',
  'tasks[].endDate',
  'tasks[].assigneeHint',
  'dependencies[].lagDays',
  'riskHints[].level',
  'milestoneHints[].targetDate',
] as const
