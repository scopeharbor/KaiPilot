/**
 * Deterministic Engine —— V2 Project Compiler 的确定性计算类型。
 *
 * 定义 schedule、graph validation、critical path、resource load、
 * hard validation、diff、evidence 的类型与 zod schema。
 * 这些类型是 Compiler 的权威计算契约，禁止 LLM 直接生成 computed 字段。
 *
 * @aiproj/compiler-spec
 */

import { z } from 'zod'

// ── Schedule ──

export const scheduleComputedSchema = z.object({
  taskId: z.string().min(1),
  /** 计划开始日期（ISO 8601 date string）。 */
  plannedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 计划结束日期（ISO 8601 date string）。 */
  plannedEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 持续时间（工作日数量）。 */
  durationWorkingDays: z.number().int().nonnegative(),
  /** 是否因 blocking 问题无法排期。 */
  blocked: z.boolean().default(false),
  /** 不可排期原因（blocked=true 时必填）。 */
  blockedReason: z.string().optional(),
})
export type ScheduleComputed = z.infer<typeof scheduleComputedSchema>

export const scheduleResultSchema = z.object({
  /** 按 taskId 索引的计划日期。 */
  scheduled: z.record(z.string(), scheduleComputedSchema),
  /** 整体是否 blocked（graph 校验未通过）。 */
  blocked: z.boolean(),
  /** 不可排期的任务 ID 列表。 */
  unscheduledTaskIds: z.array(z.string()).default([]),
  /** 警告信息。 */
  warnings: z.array(z.string()).default([]),
})
export type ScheduleResult = z.infer<typeof scheduleResultSchema>

// ── Dependency Types ──

export const dependencyTypeSchema = z.enum(['FS', 'SS', 'FF', 'SF'])
export type DependencyType = z.infer<typeof dependencyTypeSchema>

export const dependencySchema = z.object({
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: dependencyTypeSchema.default('FS'),
  lag: z.number().default(0),
})
export type Dependency = z.infer<typeof dependencySchema>

export const taskDependencySchema = z.object({
  id: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  /** 精细依赖定义（可选）。 */
  dependencies: z.array(dependencySchema).default([]).optional(),
  explicitStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  explicitEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  duration: z.number().int().nonnegative().default(1),
  isMilestone: z.boolean().default(false).optional(),
})
export type TaskDependency = z.infer<typeof taskDependencySchema>

// ── Graph Validation ──

export const validationRuleSeveritySchema = z.enum(['blocking', 'warning', 'info'])
export type ValidationRuleSeverity = z.infer<typeof validationRuleSeveritySchema>

export const validationRuleResultSchema = z.object({
  ruleId: z.string().min(1),
  severity: validationRuleSeveritySchema,
  path: z.string(),
  message: z.string(),
  sourceStageId: z.string(),
  autoFixable: z.boolean().default(false),
  requiresHumanReview: z.boolean().default(false),
  /** 关联的实体 ID。 */
  entityIds: z.array(z.string()).default([]),
})
export type ValidationRuleResult = z.infer<typeof validationRuleResultSchema>

export const graphValidationResultSchema = z.object({
  passed: z.boolean(),
  rules: z.array(validationRuleResultSchema).default([]),
  /** blocking 规则列表。 */
  blocking: z.array(validationRuleResultSchema).default([]),
  /** warning 规则列表（需人工确认）。 */
  warnings: z.array(validationRuleResultSchema).default([]),
  /** info 规则列表（仅记录）。 */
  infos: z.array(validationRuleResultSchema).default([]),
})
export type GraphValidationResult = z.infer<typeof graphValidationResultSchema>

export const graphValidationInputSchema = z.object({
  taskDependencies: z.record(z.string(), taskDependencySchema),
  dependencies: z.array(dependencySchema).default([]),
})
export type GraphValidationInput = z.infer<typeof graphValidationInputSchema>

// ── Critical Path ──

export const criticalPathTaskResultSchema = z.object({
  taskId: z.string().min(1),
  earliestStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  earliestFinish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  latestStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  latestFinish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalFloat: z.number().int(),
  isCritical: z.boolean(),
})
export type CriticalPathTaskResult = z.infer<typeof criticalPathTaskResultSchema>

export const criticalPathResultSchema = z.object({
  /** 按 taskId 索引的关键路径结果。 */
  tasks: z.record(z.string(), criticalPathTaskResultSchema),
  /** 关键路径任务 ID 列表（按拓扑顺序）。 */
  criticalPathIds: z.array(z.string()).default([]),
  /** 项目总工期（工作日）。 */
  projectDuration: z.number().int().nonnegative(),
  /** 是否 blocked（graph 校验未通过）。 */
  blocked: z.boolean(),
  /** 不可计算原因。 */
  blockedReason: z.string().optional(),
})
export type CriticalPathResult = z.infer<typeof criticalPathResultSchema>

// ── Resource Load ──

export const resourceLoadBucketSchema = z.object({
  resourceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capacity: z.number().nonnegative(),
  assignedLoad: z.number().nonnegative(),
  overload: z.boolean(),
  overloadAmount: z.number().nonnegative().default(0),
  taskIds: z.array(z.string()).default([]),
})
export type ResourceLoadBucket = z.infer<typeof resourceLoadBucketSchema>

export const resourceLoadResultSchema = z.object({
  /** 按 resourceId 索引的日期桶。 */
  buckets: z.array(resourceLoadBucketSchema),
  /** 整体是否超载。 */
  hasOverload: z.boolean(),
  /** 总超载资源日数。 */
  overloadDays: z.number().int().nonnegative().default(0),
  /** 警告信息。 */
  warnings: z.array(validationRuleResultSchema).default([]),
})
export type ResourceLoadResult = z.infer<typeof resourceLoadResultSchema>

export const resourceLoadInputSchema = z.object({
  /** resourceId → capacity per day。 */
  capacities: z.record(z.string(), z.number().nonnegative()).optional(),
  /** taskId → resourceId 分配。 */
  assignments: z.record(z.string(), z.string()),
  /** taskId → 日期区间。 */
  schedules: z.record(
    z.string(),
    z.object({
      plannedStart: z.string(),
      plannedEnd: z.string(),
    }),
  ),
})
export type ResourceLoadInput = z.infer<typeof resourceLoadInputSchema>

// ── Hard Validation ──

export const hardValidationReportSchema = z.object({
  passed: z.boolean(),
  rules: z.array(validationRuleResultSchema).default([]),
  blocking: z.array(validationRuleResultSchema).default([]),
  warnings: z.array(validationRuleResultSchema).default([]),
  infos: z.array(validationRuleResultSchema).default([]),
  /** 自动修正候选补丁（见 autoFixCandidateSchema）。 */
  autoFixCandidates: z.array(z.any()).default([]),
})
export type HardValidationReport = z.infer<typeof hardValidationReportSchema>

export const autoFixCandidateSchema = z.object({
  patchId: z.string().min(1),
  ruleId: z.string().min(1),
  description: z.string(),
  /** 补丁路径。 */
  path: z.string(),
  /** 原值。 */
  before: z.unknown(),
  /** 新值。 */
  after: z.unknown(),
  entityId: z.string().optional(),
  diff: z.any().optional(),
})
export type AutoFixCandidate = z.infer<typeof autoFixCandidateSchema>

// ── Diff ──

export const diffOpSchema = z.enum(['add', 'update', 'remove'])
export type DiffOp = z.infer<typeof diffOpSchema>

export const pdmDiffItemSchema = z.object({
  op: diffOpSchema,
  path: z.string(),
  entityId: z.string().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: z.string().default(''),
  sourceStageId: z.string(),
  ruleId: z.string().optional(),
})
export type PdmDiffItem = z.infer<typeof pdmDiffItemSchema>

export const pdmDiffSchema = z.object({
  items: z.array(pdmDiffItemSchema),
  totalChanges: z.number().int().nonnegative(),
  sourceStageId: z.string(),
  generatedAt: z.string().datetime(),
})
export type PdmDiff = z.infer<typeof pdmDiffSchema>

// ── Evidence ──

export const engineEvidenceSchema = z.object({
  stageId: z.string().min(1),
  engineVersion: z.string(),
  ruleSetVersion: z.string().default('1.0'),
  inputSignature: z.string(),
  outputSummary: z.record(z.string(), z.unknown()).default({}),
  diffSummary: z
    .object({
      totalChanges: z.number().int().nonnegative().default(0),
      ruleIds: z.array(z.string()).default([]),
    })
    .default({ totalChanges: 0, ruleIds: [] }),
  validationResult: z
    .object({
      passed: z.boolean().default(true),
      blockingCount: z.number().int().nonnegative().default(0),
      warningCount: z.number().int().nonnegative().default(0),
    })
    .default({ passed: true, blockingCount: 0, warningCount: 0 }),
  /** 扩展字段。 */
  metadata: z.record(z.string(), z.unknown()).default({}),
})
export type EngineEvidence = z.infer<typeof engineEvidenceSchema>

// ── Working Calendar ──

export const workingCalendarSchema = z.object({
  /** 项目日历 ID。 */
  calendarId: z.string().default('default'),
  /** 工作日（0=周日, 1=周一, ..., 6=周六）。 */
  workingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  /** 排除日期列表（holidays, ISO date strings）。 */
  excludedDates: z.array(z.string()).default([]),
})
export type WorkingCalendar = z.infer<typeof workingCalendarSchema>

// ── Service Result Wrapper ──

export const deterministicEngineResultSchema = z.object({
  schedule: scheduleResultSchema.optional(),
  graphValidation: graphValidationResultSchema.optional(),
  criticalPath: criticalPathResultSchema.optional(),
  resourceLoad: resourceLoadResultSchema.optional(),
  hardValidation: hardValidationReportSchema.optional(),
  diff: pdmDiffSchema.optional(),
  evidence: z.array(engineEvidenceSchema).default([]),
  /** 整体是否 blocked。 */
  blocked: z.boolean().default(false),
  /** blocking 规则摘要。 */
  blockingSummary: z.array(z.string()).default([]),
})
export type DeterministicEngineResult = z.infer<typeof deterministicEngineResultSchema>
