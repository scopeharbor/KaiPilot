/**
 * Generation Manifest —— 从 Contract 派生的执行计划，Executor 消费的唯一生成调度来源。
 *
 * Manifest 必须从 Generation Contract 派生，包含实体登记、批次、依赖、执行顺序、
 * 生成策略、模型模式、输出预算、验证器与输出引用。
 * 任何未登记的实体禁止进入 PDM 或 Ledger。
 *
 * @aiproj/compiler-spec
 */

import { z } from 'zod'

// ── Manifest Metadata ──

export const manifestMetaSchema = z.object({
  schemaVersion: z.string().default('2.0'),
  manifestVersion: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  contractVersion: z.number().int().positive(),
  contractHash: z.string().min(1),
})
export type ManifestMeta = z.infer<typeof manifestMetaSchema>

// ── Model Mode ──

export const modelModeSchema = z.enum(['thinking', 'non-thinking'])
export type ModelMode = z.infer<typeof modelModeSchema>

// ── Generation Strategy ──

export const generationStrategySchema = z.enum([
  'llm_generate',
  'deterministic_compute',
  'hybrid_llm_validate',
  'template_fill',
])
export type GenerationStrategy = z.infer<typeof generationStrategySchema>

// ── Entity Validator ──

export const entityValidatorSchema = z.object({
  validatorId: z.string().min(1),
  validatorType: z.enum([
    'json_schema',
    'contract_match',
    'reference_integrity',
    'field_presence',
    'id_uniqueness',
    'custom',
  ]),
  description: z.string().default(''),
  config: z.record(z.string(), z.unknown()).default({}),
})
export type EntityValidator = z.infer<typeof entityValidatorSchema>

// ── Manifest Entity (Enhanced) ──

export const manifestEntitySchema = z.object({
  entityId: z.string().min(1),
  entityType: z.enum([
    'workstream',
    'work_package',
    'task_l1',
    'task_l2',
    'milestone',
    'risk',
    'resource',
    'stakeholder',
  ]),
  contractRef: z.string().min(1),
  label: z.string().min(1).max(200),
  parentEntityId: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  stageId: z.string().min(1),
  batchId: z.string().optional(),
  strategy: generationStrategySchema.default('llm_generate'),
  modelMode: modelModeSchema.default('non-thinking'),
  maxOutputBudget: z.number().int().nonnegative().default(4096),
  validators: z.array(entityValidatorSchema).default([]),
  status: z
    .enum([
      'pending',
      'ready',
      'generating',
      'generated',
      'validating',
      'validated',
      'committed_to_pdm',
      'failed_retryable',
      'needs_human_review',
      'skipped_by_user',
    ])
    .default('pending'),
  outputRef: z.string().optional(),
  attemptCount: z.number().int().nonnegative().default(0),
  maxRetries: z.number().int().nonnegative().default(3),
})
export type ManifestEntity = z.infer<typeof manifestEntitySchema>

// ── Batch Plan ──

export const batchPlanSchema = z.object({
  batchId: z.string().min(1),
  entityIds: z.array(z.string()).min(1),
  stageId: z.string().min(1),
  maxTokens: z.number().int().positive().default(4096),
  jsonSchemaName: z.string().optional(),
  modelMode: modelModeSchema.default('non-thinking'),
  strategy: generationStrategySchema.default('llm_generate'),
})
export type BatchPlan = z.infer<typeof batchPlanSchema>

// ── Execution Phase ──

export const executionPhaseSchema = z.object({
  phaseId: z.string().min(1),
  phase: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  parallelGroup: z.string().optional(),
  batchIds: z.array(z.string()).default([]),
})
export type ExecutionPhase = z.infer<typeof executionPhaseSchema>

// ── Token Budget ──

export const tokenBudgetSchema = z.object({
  totalEstimated: z.number().int().nonnegative().default(0),
  perBatch: z.record(z.string(), z.number().int().nonnegative()).default({}),
  perEntity: z.record(z.string(), z.number().int().nonnegative()).default({}),
})
export type TokenBudget = z.infer<typeof tokenBudgetSchema>

// ── Enhanced GenerationManifest ──

/**
 * GenerationManifest —— 从 Contract 派生的完整执行计划。
 *
 * 包含实体登记册（每个待生成实体）、批次计划、执行阶段、
 * 模型模式选择、Token 预算、验证规则和输出引用。
 * Executor 只按 Manifest 中登记的实体与顺序执行。
 */
export const generationManifestSchema = z.object({
  meta: manifestMetaSchema,
  entities: z.array(manifestEntitySchema).default([]),
  batchPlan: z.array(batchPlanSchema).default([]),
  executionPhases: z.array(executionPhaseSchema).default([]),
  tokenBudget: tokenBudgetSchema.default({ totalEstimated: 0, perBatch: {}, perEntity: {} }),
  totalEntities: z.number().int().nonnegative(),
  completedEntities: z.number().int().nonnegative().default(0),
  failedEntities: z.number().int().nonnegative().default(0),
})
export type GenerationManifest = z.infer<typeof generationManifestSchema>
