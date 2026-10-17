/**
 * v2-project-compiler-foundation —— PDM（Project Data Model）核心类型与 zod schema（design D2/D10）。
 *
 * PDM 是 Compiler 的唯一正式产出。本文件定义分层实体类型与对应 zod schema，
 * 供前后端共享验证。computed 字段仅做最小占位并标注 TODO-DEBT。
 *
 * ⚠️ 本文件变更需同步更新 index.ts 导出。
 */

import { z } from 'zod'

// ── Entity ID ──

export const entityIdSchema = z.string().min(4).max(64)

// ── Metadata ──

export const pdmMetadataSchema = z.object({
  schemaVersion: z.string(),
  compilerVersion: z.string(),
  generatedAt: z.string().datetime(),
  projectId: z.string(),
  runId: z.number().int().positive(),
})

export type PdmMetadata = z.infer<typeof pdmMetadataSchema>

// ── Intent ──

export const rawIntentSchema = z.object({
  text: z.string().min(1).max(10000),
  detectedLanguage: z.string().default('zh-CN'),
  receivedAt: z.string().datetime(),
})

export type RawIntent = z.infer<typeof rawIntentSchema>

export const parsedIntentSchema = z.object({
  projectName: z.string().min(1).max(200),
  projectType: z.string(),
  summary: z.string().max(2000),
  objectives: z.array(z.string()).default([]),
  scope: z.string().default(''),
  constraints: z.array(z.string()).default([]),
  stakeholders: z.array(z.string()).default([]),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

export type ParsedIntent = z.infer<typeof parsedIntentSchema>

// ── Blueprint ──

export const resourceSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  role: z.string().default(''),
  count: z.number().int().positive().default(1),
})

export type Resource = z.infer<typeof resourceSchema>

export const stakeholderSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  role: z.string().default(''),
  impact: z.enum(['high', 'medium', 'low']).default('medium'),
})

export type Stakeholder = z.infer<typeof stakeholderSchema>

export const riskSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  probability: z.enum(['low', 'medium', 'high']).default('medium'),
  impact: z.enum(['low', 'medium', 'high']).default('medium'),
  mitigation: z.string().default(''),
})

export type Risk = z.infer<typeof riskSchema>

export const milestoneSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  dueDate: z.string().optional(),
  criteria: z.array(z.string()).default([]),
})

export type Milestone = z.infer<typeof milestoneSchema>

export const taskL2Schema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  estimatedHours: z.number().nonnegative().default(0),
  assignee: z.string().optional(),
  dependsOn: z.array(entityIdSchema).default([]),
})

export type TaskL2 = z.infer<typeof taskL2Schema>

export const taskL1Schema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  estimatedHours: z.number().nonnegative().default(0),
  deliverables: z.array(z.string()).default([]),
  dependsOn: z.array(entityIdSchema).default([]),
  children: z.array(taskL2Schema).default([]),
})

export type TaskL1 = z.infer<typeof taskL1Schema>

export const workPackageSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  estimatedHours: z.number().nonnegative().default(0),
  dependsOn: z.array(entityIdSchema).default([]),
  tasks: z.array(taskL1Schema).default([]),
})

export type WorkPackage = z.infer<typeof workPackageSchema>

export const workstreamSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  workPackages: z.array(workPackageSchema).default([]),
})

export type Workstream = z.infer<typeof workstreamSchema>

// ── Computed（最小占位，TODO-DEBT: V2-deterministic-engine-baseline owns concrete computed fields）──

export const computedSchema = z.object({
  status: z.string().default('pending'),
  totalEstimatedHours: z.number().nonnegative().default(0),
  // TODO-DEBT: V2-deterministic-engine-baseline 扩展 computed 字段
})

export type Computed = z.infer<typeof computedSchema>

// ── Manifest（GenerationManifest 的 PDM 部分引用）──

export const pdmManifestSchema = z.object({
  entities: z.array(
    z.object({
      id: entityIdSchema,
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
      stageId: z.string(),
      status: z
        .enum(['pending', 'running', 'completed', 'failed', 'needs_human_review', 'skipped'])
        .default('pending'),
    }),
  ),
})

export type PdmManifest = z.infer<typeof pdmManifestSchema>

// ── Validation ──

export const validationSchema = z.object({
  level: z.number().int().min(0).max(1),
  passed: z.boolean(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
        code: z.string().default('VALIDATION_ERROR'),
      }),
    )
    .default([]),
  warnings: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .default([]),
})

export type Validation = z.infer<typeof validationSchema>

// ── Ledger（CompletenessLedger 的 PDM 部分引用）──

export const pdmLedgerSchema = z.object({
  overallCompleteness: z.number().min(0).max(1).default(0),
  blockingItems: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
})

export type PdmLedger = z.infer<typeof pdmLedgerSchema>

// ── 完整 PDM ──

export const pdmSchema = z.object({
  metadata: pdmMetadataSchema,
  intent: rawIntentSchema,
  parsedIntent: parsedIntentSchema.optional(),
  blueprint: z.object({
    workstreams: z.array(workstreamSchema).default([]),
    milestones: z.array(milestoneSchema).default([]),
    risks: z.array(riskSchema).default([]),
    resources: z.array(resourceSchema).default([]),
    stakeholders: z.array(stakeholderSchema).default([]),
  }),
  manifest: pdmManifestSchema.optional(),
  validation: validationSchema.optional(),
  ledger: pdmLedgerSchema.optional(),
  computed: computedSchema.optional(),
})

export type ProjectDataModel = z.infer<typeof pdmSchema>
