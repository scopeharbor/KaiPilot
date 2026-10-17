/**
 * @aiproj/compiler-spec —— Validation 套件：Hard Validator / Soft Evaluator / V-Gate / Evidence 类型与 zod schema。
 *
 * V2 Project Compiler 验证体系的数据契约：
 * - Hard Validator：确定性规则引擎（HV-001~HV-025），由注册表 + implementation 映射组成
 * - Soft Evaluator：LLM 辅助非阻断质量评估（SE-WBS-01~SE-COMM-01 共 17 维）
 * - V-Gate：Hard + Soft 的决策汇总，输出 pass / conditional_pass / blocked / awaiting_review
 * - Evidence：所有验证与评估的可追踪记录，写入 Manifest/Ledger
 * - Cost Summary：Soft Evaluator 的调用开销追踪
 *
 * 本文件只定义类型与 zod schema，不包含任何执行逻辑。
 *
 * ⚠️ 新增 public type/function 必须同步更新 index.ts re-export。
 */

import { z } from 'zod'

// ============================================================================
// 1. Hard Validator 规则注册表类型（HV-001~HV-025）
// ============================================================================

/** Hard Validator 规则类别。 */
export const hardRuleCategorySchema = z.enum([
  'schema_parse',
  'reference_integrity',
  'structure',
  'date_schedule',
  'numeric',
  'resource',
  'raci',
  'risk',
  'blueprint_consistency',
  'stage_metadata',
])
export type HardRuleCategory = z.infer<typeof hardRuleCategorySchema>

/** HV 规则默认严重度。 */
export const hardRuleDefaultSeveritySchema = z.enum([
  'blocking',
  'warning',
  'info',
  'not_applicable',
])
export type HardRuleDefaultSeverity = z.infer<typeof hardRuleDefaultSeveritySchema>

/** HV 规则适用的 V-Gate profile。 */
export const hardRuleApplicableProfileSchema = z.enum([
  'requirements_gate',
  'blueprint_gate',
  'wbs_gate',
  'schedule_gate',
  'resource_gate',
  'global_sample',
  'all',
])
export type HardRuleApplicableProfile = z.infer<typeof hardRuleApplicableProfileSchema>

/** HV 规则所需的确定性输入。 */
export const hardRuleRequiredInputSchema = z.enum([
  'pdm_schema_parse',
  'graph_validation',
  'schedule_result',
  'critical_path_result',
  'resource_load_result',
  'diff_result',
  'stage_metadata',
  'pdm_snapshot',
])
export type HardRuleRequiredInput = z.infer<typeof hardRuleRequiredInputSchema>

/** HV 规则注册表条目。 */
export const hardRuleRegistryEntrySchema = z.object({
  /** 规范规则 ID，如 "HV-001"。 */
  ruleId: z.string().min(1),
  /** 规则名称。 */
  name: z.string().min(1),
  /** 规则类别。 */
  category: hardRuleCategorySchema,
  /** 描述。 */
  description: z.string(),
  /** 默认严重度。 */
  defaultSeverity: hardRuleDefaultSeveritySchema,
  /** 适用的 V-Gate profile 列表。 */
  applicableProfiles: z.array(hardRuleApplicableProfileSchema).default(['all']),
  /** 需要哪些确定性输入。 */
  requiredInputs: z.array(hardRuleRequiredInputSchema).default([]),
  /** 实现层规则 ID（一个实现可覆盖多个 sourceRuleIds）。 */
  implementationId: z.string().min(1),
  /** 来源规则 ID 列表（当该条目是聚合实现时）。 */
  sourceRuleIds: z.array(z.string()).default([]),
  /** 是否自动可修复。 */
  autoFixable: z.boolean().default(false),
  /** 是否需要人工复核。 */
  requiresHumanReview: z.boolean().default(false),
})
export type HardRuleRegistryEntry = z.infer<typeof hardRuleRegistryEntrySchema>

/** HV 规则实现注册表条目（实现层，可覆盖多个规范规则）。 */
export const hardRuleImplementationSchema = z.object({
  /** 实现 ID。 */
  implementationId: z.string().min(1),
  /** 覆盖的规范规则 ID 列表。 */
  sourceRuleIds: z.array(z.string()).min(1),
  /** 实现描述。 */
  description: z.string(),
  /** 所需输入。 */
  requiredInputs: z.array(hardRuleRequiredInputSchema).default([]),
})
export type HardRuleImplementation = z.infer<typeof hardRuleImplementationSchema>

/** HV 默认注册表（所有 25 条规则 + implementation 映射）。 */
export const hardRuleRegistrySchema = z.object({
  schemaVersion: z.string().default('2.0'),
  /** 规则注册表条目（按规范 ID 索引）。 */
  rules: z.array(hardRuleRegistryEntrySchema),
  /** 实现注册表（按 implementationId 索引）。 */
  implementations: z.array(hardRuleImplementationSchema).default([]),
  /** 规则集版本。 */
  rulesetVersion: z.string().default('1.0'),
})
export type HardRuleRegistry = z.infer<typeof hardRuleRegistrySchema>

// ============================================================================
// 2. Hard Validation Report
// ============================================================================

/** HV issue 详细结果。 */
export const hardValidationIssueSchema = z.object({
  ruleId: z.string().min(1),
  severity: hardRuleDefaultSeveritySchema,
  category: hardRuleCategorySchema,
  path: z.string(),
  message: z.string(),
  /** 受影响的实体 ID 列表。 */
  affectedEntityIds: z.array(z.string()).default([]),
  /** 是否可自动修复。 */
  autoFixable: z.boolean().default(false),
  /** 是否需要人工复核。 */
  requiresHumanReview: z.boolean().default(false),
  /** 来源 Stage ID。 */
  sourceStageId: z.string(),
  /** 证据（结构化或摘要）。 */
  evidence: z.string().default(''),
  /** implementationId（如果有聚合）。 */
  implementationId: z.string().optional(),
})
export type HardValidationIssue = z.infer<typeof hardValidationIssueSchema>

/** HV not_applicable 规则记录。 */
export const hardValidationNotApplicableSchema = z.object({
  ruleId: z.string().min(1),
  reason: z.string(),
  category: hardRuleCategorySchema,
})
export type HardValidationNotApplicable = z.infer<typeof hardValidationNotApplicableSchema>

/** HV 输入签名。 */
export const hardValidationInputSignatureSchema = z.object({
  schemaParsed: z.boolean(),
  graphAvailable: z.boolean(),
  scheduleAvailable: z.boolean(),
  criticalPathAvailable: z.boolean(),
  resourceLoadAvailable: z.boolean(),
  diffAvailable: z.boolean(),
  stageMetadataAvailable: z.boolean(),
  pdmSnapshotId: z.string().optional(),
})
export type HardValidationInputSignature = z.infer<typeof hardValidationInputSignatureSchema>

/** Hard Validation Report 完整结构。 */
export const v2HardValidationReportSchema = z.object({
  validationId: z.string().min(1),
  stageId: z.string().min(1),
  pdmSnapshotId: z.string().optional(),
  rulesetVersion: z.string(),
  /** 执行摘要。 */
  summary: z.object({
    totalRules: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
    notApplicable: z.number().int().nonnegative(),
    inputMissing: z.number().int().nonnegative(),
  }),
  /** 所有 issue 列表。 */
  issues: z.array(hardValidationIssueSchema).default([]),
  /** not_applicable 规则列表。 */
  notApplicableRules: z.array(hardValidationNotApplicableSchema).default([]),
  /** 输入签名。 */
  inputSignature: hardValidationInputSignatureSchema,
  /** 是否全量校验（false = 增量校验）。 */
  isFullValidation: z.boolean().default(true),
  /** 增量校验时跳过的规则与原因。 */
  skippedRules: z
    .array(
      z.object({
        ruleIds: z.array(z.string()),
        reason: z.string(),
      }),
    )
    .default([]),
  generatedAt: z.string().datetime(),
})
export type V2HardValidationReport = z.infer<typeof v2HardValidationReportSchema>

// ============================================================================
// 3. Soft Evaluator 维度注册表类型（SE-WBS-01~SE-COMM-01）
// ============================================================================

/** Soft 维度分组。 */
export const softDimensionGroupSchema = z.enum([
  'wbs',
  'deliverable',
  'risk',
  'progress_resource',
  'scope_target',
  'communication',
])
export type SoftDimensionGroup = z.infer<typeof softDimensionGroupSchema>

/** Soft 维度 rubric 条目。 */
export const softDimensionRubricSchema = z.object({
  score: z.number().min(1).max(5),
  description: z.string(),
  criteria: z.array(z.string()).default([]),
})
export type SoftDimensionRubric = z.infer<typeof softDimensionRubricSchema>

/** Soft 维度注册表条目。 */
export const softDimensionRegistryEntrySchema = z.object({
  /** 维度 ID，如 "SE-WBS-01"。 */
  dimensionId: z.string().min(1),
  /** 维度名称。 */
  name: z.string().min(1),
  /** 分组。 */
  group: softDimensionGroupSchema,
  /** 权重（同一分组内归一化）。 */
  weight: z.number().min(0).max(1).default(0.5),
  /** 评分 rubric（1-5 分制）。 */
  rubric: z.array(softDimensionRubricSchema).default([]),
  /** 输入片段 schema 描述（用于构建 prompt）。 */
  inputSliceSchema: z.string(),
  /** 适用的 V-Gate profile。 */
  applicableProfiles: z.array(z.string()).default([]),
  /** 默认评分阈值（低于此值进入 attention）。 */
  defaultThreshold: z.number().min(1).max(5).default(3),
  /** 可替代的确定性信号列表（用于注入 prompt 的统计/规则摘要）。 */
  deterministicSignals: z.array(z.string()).default([]),
})
export type SoftDimensionRegistryEntry = z.infer<typeof softDimensionRegistryEntrySchema>

/** Soft 维度注册表。 */
export const softDimensionRegistrySchema = z.object({
  schemaVersion: z.string().default('2.0'),
  dimensions: z.array(softDimensionRegistryEntrySchema),
  registryVersion: z.string().default('1.0'),
})
export type SoftDimensionRegistry = z.infer<typeof softDimensionRegistrySchema>

// ============================================================================
// 4. Evaluation Profile
// ============================================================================

/** Evaluation profile 定义。 */
export const evaluationProfileSchema = z.object({
  /** Profile ID。 */
  profileId: z.string().min(1),
  /** 名称。 */
  name: z.string(),
  /** 包含的维度 ID 列表。 */
  dimensionIds: z.array(z.string()),
  /** 各维度权重覆盖（可选）。 */
  weightOverrides: z.record(z.string(), z.number().min(0).max(1)).default({}),
  /** 各维度阈值覆盖（可选）。 */
  thresholdOverrides: z.record(z.string(), z.number().min(1).max(5)).default({}),
  /** 预算上限（token 数，0 = 无限制）。 */
  budgetTokens: z.number().int().nonnegative().default(0),
  /** 预算上限（调用次数，0 = 无限制）。 */
  budgetCalls: z.number().int().nonnegative().default(0),
  /** 单维度最大重试次数。 */
  maxRetriesPerDimension: z.number().int().nonnegative().default(2),
  /** 是否默认启用 soft evaluation。 */
  enabledByDefault: z.boolean().default(false),
  /** 描述。 */
  description: z.string().default(''),
})
export type EvaluationProfile = z.infer<typeof evaluationProfileSchema>

// ============================================================================
// 5. Soft Evaluation Report
// ============================================================================

/** 单维度评分结果。 */
export const softDimensionScoreSchema = z.object({
  dimensionId: z.string().min(1),
  score: z.number().min(0).max(5).default(0),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  /** 关联的 finding 列表。 */
  findings: z
    .array(
      z.object({
        findingId: z.string().optional(),
        description: z.string(),
        severity: z.enum(['info', 'warning', 'attention']).default('info'),
        /** 受影响的实体 ID（可为空）。 */
        affectedEntityIds: z.array(z.string()).default([]),
        /** 是否为 unanchored finding（模型未引用有效 entity id）。 */
        unanchored: z.boolean().default(false),
        /** 证据片段。 */
        evidenceSnippet: z.string().default(''),
        /** 建议的人工复核操作。 */
        suggestedReviewAction: z.string().default(''),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .default([]),
  status: z.enum(['evaluated', 'unavailable', 'skipped']).default('evaluated'),
  /** 不可用原因（status=unavailable 时填写）。 */
  unavailableReason: z.string().optional(),
  /** 本次评估的 attempt id。 */
  attemptId: z.string().optional(),
  /** 使用的 provider/model。 */
  provider: z.string().optional(),
  model: z.string().optional(),
  /** 本次评估消耗的 tokens。 */
  tokensUsed: z.number().int().nonnegative().default(0),
  /** 延迟（ms）。 */
  latencyMs: z.number().int().nonnegative().default(0),
  /** 重试次数。 */
  retryCount: z.number().int().nonnegative().default(0),
})
export type SoftDimensionScore = z.infer<typeof softDimensionScoreSchema>

/** 成本与延迟汇总。 */
export const costAndLatencySummarySchema = z.object({
  totalCalls: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalLatencyMs: z.number().int().nonnegative(),
  provider: z.string().default(''),
  model: z.string().default(''),
  dimensionCount: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  /** 预算状态。 */
  budgetStatus: z.enum(['within_budget', 'budget_exceeded', 'no_budget']).default('within_budget'),
  /** 预算上限（原始）。 */
  budgetLimitTokens: z.number().int().nonnegative().default(0),
  budgetLimitCalls: z.number().int().nonnegative().default(0),
})
export type CostAndLatencySummary = z.infer<typeof costAndLatencySummarySchema>

/** Soft Evaluation Report 完整结构。 */
export const softEvaluationReportSchema = z.object({
  evaluationId: z.string().min(1),
  profile: evaluationProfileSchema,
  model: z.string(),
  /** 评估的维度列表。 */
  dimensionsEvaluated: z.array(z.string()).default([]),
  /** 总体分数（未加权平均）。 */
  overallScore: z.number().min(0).max(5).optional(),
  /** 加权总分。 */
  weightedScore: z.number().min(0).max(5).optional(),
  /** 整体状态。 */
  status: z.enum(['completed', 'partial', 'all_unavailable', 'budget_exceeded', 'skipped']),
  /** 各维度评分。 */
  dimensionScores: z.array(softDimensionScoreSchema).default([]),
  /** 总体 confidence。 */
  confidence: z.number().min(0).max(1).optional(),
  /** 成本与延迟汇总。 */
  costAndLatencySummary: costAndLatencySummarySchema,
  generatedAt: z.string().datetime(),
})
export type SoftEvaluationReport = z.infer<typeof softEvaluationReportSchema>

// ============================================================================
// 6. V-Gate Decision
// ============================================================================

/** V-Gate 决策状态。 */
export const vGateDecisionStatusSchema = z.enum([
  'pass',
  'conditional_pass',
  'blocked',
  'awaiting_review',
])
export type VGateDecisionStatus = z.infer<typeof vGateDecisionStatusSchema>

/** V-Gate 决策完整结构。 */
export const vGateDecisionSchema = z.object({
  decisionId: z.string().min(1),
  stageId: z.string().min(1),
  profileId: z.string(),
  status: vGateDecisionStatusSchema,
  /** 阻断原因（status=blocked 时必填）。 */
  blockingReasons: z.array(z.string()).default([]),
  /** 警告信息。 */
  warnings: z.array(z.string()).default([]),
  /** 关注区域（如低分维度）。 */
  attentionAreas: z
    .array(
      z.object({
        area: z.string(),
        description: z.string(),
        severity: z.enum(['info', 'warning', 'attention']).default('info'),
      }),
    )
    .default([]),
  /** 是否需要人工复核。 */
  requiresHumanReview: z.boolean().default(false),
  /** 允许的下一步操作。 */
  allowedNextActions: z.array(z.string()).default([]),
  /** 证据引用（指向 Manifest/Ledger 中的 evidence artifacts）。 */
  evidenceRefs: z.array(z.string()).default([]),
  /** 硬校验报告摘要。 */
  hardSummary: z.object({
    totalBlocking: z.number().int().nonnegative(),
    totalWarnings: z.number().int().nonnegative(),
    passed: z.boolean(),
  }),
  /** 软评估报告摘要（可选）。 */
  softSummary: z
    .object({
      overallScore: z.number().min(0).max(5).optional(),
      weightedScore: z.number().min(0).max(5).optional(),
      dimensionsEvaluated: z.number().int().nonnegative(),
      status: z.string(),
    })
    .optional(),
  /** 修复建议（仅保存为 candidate，不得直接修改正式数据）。 */
  repairSuggestions: z
    .array(
      z.object({
        suggestionId: z.string(),
        dimensionId: z.string().optional(),
        ruleId: z.string().optional(),
        description: z.string(),
        suggestedAction: z.string(),
        affectedEntityIds: z.array(z.string()).default([]),
        priority: z.enum(['low', 'medium', 'high']).default('medium'),
      }),
    )
    .default([]),
  generatedAt: z.string().datetime(),
})
export type VGateDecision = z.infer<typeof vGateDecisionSchema>

// ============================================================================
// 7. Validation Ledger Evidence
// ============================================================================

/** 验证证据条目（写入 Ledger 或 Manifest 的标准化格式）。 */
export const validationLedgerEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  stageId: z.string().min(1),
  /** 证据类型。 */
  evidenceType: z.enum([
    'hard_validation_complete',
    'soft_evaluation_complete',
    'v_gate_decision',
    'soft_evaluation_skipped',
    'soft_evaluation_degraded',
    'budget_exceeded',
    'repair_suggestion_generated',
  ]),
  /** 输入签名。 */
  inputSignature: z.record(z.string(), z.unknown()).default({}),
  /** 规则/维度版本。 */
  rulesetVersion: z.string().default(''),
  registryVersion: z.string().default(''),
  /** 输出摘要。 */
  outputSummary: z.record(z.string(), z.unknown()).default({}),
  /** 成本摘要。 */
  costSummary: z
    .object({
      tokensUsed: z.number().int().nonnegative().default(0),
      callsMade: z.number().int().nonnegative().default(0),
      latencyMs: z.number().int().nonnegative().default(0),
    })
    .default({ tokensUsed: 0, callsMade: 0, latencyMs: 0 }),
  /** 跳过/降级原因（evidenceType=skipped/degraded 时必填）。 */
  skippedReason: z.string().optional(),
  degradedReason: z.string().optional(),
  /** 关联的 repair suggestion IDs。 */
  repairSuggestionIds: z.array(z.string()).default([]),
  generatedAt: z.string().datetime(),
})
export type ValidationLedgerEvidence = z.infer<typeof validationLedgerEvidenceSchema>

// ============================================================================
// 8. Validation Input Context（供 Service 使用，纯类型导出）
// ============================================================================

/** 验证输入上下文——PDM snapshot、stage context、deterministic outputs、policy profile 的封装。 */
export const validationInputContextSchema = z.object({
  /** PDM snapshot ID。 */
  pdmSnapshotId: z.string().optional(),
  /** PDM snapshot（序列化后的 JSON）。 */
  pdmSnapshot: z.unknown().optional(),
  /** Stage context。 */
  stageId: z.string().min(1),
  stageName: z.string().optional(),
  /** Deterministic 引擎输出（按需传递）。 */
  deterministicOutputs: z
    .object({
      graphValidation: z.unknown().optional(),
      schedule: z.unknown().optional(),
      criticalPath: z.unknown().optional(),
      resourceLoad: z.unknown().optional(),
      diff: z.unknown().optional(),
    })
    .default({}),
  /** Policy profile ID。 */
  profileId: z.string().default('global_sample'),
  /** 组织 ID。 */
  organizationId: z.string().optional(),
  /** Run ID。 */
  runId: z.string().optional(),
  /** 是否为增量校验。 */
  isIncremental: z.boolean().default(false),
  /** 增量校验时的变更路径。 */
  changedPaths: z.array(z.string()).default([]),
  changedEntityIds: z.array(z.string()).default([]),
})
export type ValidationInputContext = z.infer<typeof validationInputContextSchema>

// ============================================================================
// 9. HV-001~HV-025 规范规则 ID 常量
// ============================================================================

/** HV-001~HV-025 规范规则 ID 常量。 */
export const HV_RULE_IDS = {
  // ── Schema Parse（2 rules）──
  HV_001: 'HV-001', // PDM schema parse 完整
  HV_002: 'HV-002', // Enum/format 字段正确

  // ── Reference Integrity（4 rules）──
  HV_003: 'HV-003', // 依赖目标存在
  HV_004: 'HV-004', // 资源分配目标存在
  HV_005: 'HV-005', // RACI 角色存在
  HV_006: 'HV-006', // 里程碑关联任务存在

  // ── Structure（4 rules）──
  HV_007: 'HV-007', // 层级完整性（无 gap/orphan）
  HV_008: 'HV-008', // 依赖环路检测
  HV_009: 'HV-009', // 非循环依赖
  HV_010: 'HV-010', // 拓扑排序可行性

  // ── Date / Schedule（4 rules）──
  HV_011: 'HV-011', // 日期一致性（end >= start）
  HV_012: 'HV-012', // 依赖日期逻辑
  HV_013: 'HV-013', // 日历合规
  HV_014: 'HV-014', // 里程碑日期对齐

  // ── Numeric（4 rules）──
  HV_015: 'HV-015', // Effort 汇总一致性
  HV_016: 'HV-016', // Budget 汇总一致性
  HV_017: 'HV-017', // Progress 数值范围
  HV_018: 'HV-018', // 工期非负

  // ── Resource（3 rules）──
  HV_019: 'HV-019', // 资源容量未超载
  HV_020: 'HV-020', // 资源分配不重叠
  HV_021: 'HV-021', // 资源技能匹配

  // ── RACI（2 rules）──
  HV_022: 'HV-022', // RACI 矩阵完整
  HV_023: 'HV-023', // 关键任务有负责人

  // ── Risk（1 rule）──
  HV_024: 'HV-024', // 风险登记册完整

  // ── Blueprint Consistency（1 rule）──
  HV_025: 'HV-025', // Blueprint 映射一致性
} as const

/** SE 17 维维度 ID 常量。 */
export const SE_DIMENSION_IDS = {
  // ── WBS（3 dimensions）──
  SE_WBS_01: 'SE-WBS-01', // WBS 分解完整性
  SE_WBS_02: 'SE-WBS-02', // 任务粒度合理性
  SE_WBS_03: 'SE-WBS-03', // 层级深度适当

  // ── Deliverable（3 dimensions）──
  SE_DEL_01: 'SE-DEL-01', // 交付物可验证性
  SE_DEL_02: 'SE-DEL-02', // 验收标准可度量
  SE_DEL_03: 'SE-DEL-03', // 交付物依赖明确

  // ── Risk（3 dimensions）──
  SE_RISK_01: 'SE-RISK-01', // 风险识别充分性
  SE_RISK_02: 'SE-RISK-02', // 风险缓解措施可行
  SE_RISK_03: 'SE-RISK-03', // 风险概率影响一致

  // ── Progress / Resource（3 dimensions）──
  SE_PR_01: 'SE-PR-01', // 进度计划可信度
  SE_PR_02: 'SE-PR-02', // 资源分配合理性
  SE_PR_03: 'SE-PR-03', // 里程碑可达性

  // ── Scope / Target（3 dimensions）──
  SE_ST_01: 'SE-ST-01', // 范围完整性
  SE_ST_02: 'SE-ST-02', // 目标一致性
  SE_ST_03: 'SE-ST-03', // 约束可满足性

  // ── Communication（2 dimensions）──
  SE_COMM_01: 'SE-COMM-01', // 干系人覆盖完整
  SE_COMM_02: 'SE-COMM-02', // 沟通频率适当
} as const
