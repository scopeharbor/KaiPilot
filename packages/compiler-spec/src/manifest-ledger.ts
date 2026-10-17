/**
 * v2-project-compiler-foundation —— GenerationManifest 与 CompletenessLedger 类型与 schema（tasks 2.6）。
 *
 * Manifest 描述编译运行的计划（Stage 顺序、实体依赖），Ledger 追踪交付物完成度。
 * status 字段使用有限枚举，不用自由字符串。
 *
 * ⚠️ 本文件变更需同步更新 index.ts 导出。
 */

import { z } from 'zod'

// ── Manifest Status Enum ──

export const manifestEntityStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'needs_human_review',
  'skipped',
])
export type ManifestEntityStatus = z.infer<typeof manifestEntityStatusSchema>

export const manifestStepStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'needs_human_review',
])
export type ManifestStepStatus = z.infer<typeof manifestStepStatusSchema>

// ── ManifestEntity ──

export const manifestEntitySchema = z.object({
  entityId: z.string().min(1),
  kind: z.enum([
    'workstream',
    'work_package',
    'task_l1',
    'task_l2',
    'milestone',
    'risk',
    'resource',
    'stakeholder',
  ]),
  stageId: z.string().min(1),
  status: manifestEntityStatusSchema,
  generatedAt: z.string().datetime().optional(),
  verifiedByStage: z.string().optional(),
})

export type ManifestEntity = z.infer<typeof manifestEntitySchema>

// ── ManifestExecutionStep ──

export const manifestExecutionStepSchema = z.object({
  stageId: z.string().min(1),
  phase: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  parallelGroup: z.string().optional(),
  status: manifestStepStatusSchema,
  retryCount: z.number().int().nonnegative().default(0),
  errorSummary: z.string().optional(),
})

export type ManifestExecutionStep = z.infer<typeof manifestExecutionStepSchema>

// ── GenerationManifest ──

export const generationManifestSchema = z.object({
  runId: z.number().int().positive(),
  schemaVersion: z.string().default('2.0'),
  entities: z.array(manifestEntitySchema).default([]),
  executionPlan: z.array(manifestExecutionStepSchema).default([]),
  totalStages: z.number().int().nonnegative(),
  completedStages: z.number().int().nonnegative().default(0),
  failedStages: z.number().int().nonnegative().default(0),
})

export type GenerationManifest = z.infer<typeof generationManifestSchema>

// ── LedgerDeliverable ──

export const ledgerDeliverableSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['pdm', 'manifest', 'stage_output', 'checkpoint', 'validation_report']),
  required: z.boolean().default(true),
  status: manifestEntityStatusSchema,
  generatedBy: z.string().optional(),
  verifiedBy: z.string().optional(),
  completenessScore: z.number().min(0).max(1).optional(),
  blocking: z.boolean().default(false),
})

export type LedgerDeliverable = z.infer<typeof ledgerDeliverableSchema>

// ── CompletenessLedger ──

export const completenessLedgerSchema = z.object({
  runId: z.number().int().positive(),
  schemaVersion: z.string().default('2.0'),
  deliverables: z.array(ledgerDeliverableSchema).default([]),
  overallCompleteness: z.number().min(0).max(1).default(0),
  blockingItems: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  updatedAt: z.string().datetime(),
})

export type CompletenessLedger = z.infer<typeof completenessLedgerSchema>
