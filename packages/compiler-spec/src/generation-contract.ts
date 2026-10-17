/**
 * Generation Contract —— 确定性编译产出，对 LLM 只读。
 *
 * Contract 由 Compiler 从已验证 Blueprint/PDM 上游产物确定性生成，
 * 包含预期实体、实体数量、父子/依赖关系、质量门禁、版本、来源引用与内容 hash。
 * LLM Stage 禁止创建、修改或补写 Contract。
 *
 * @aiproj/compiler-spec
 */

import { z } from 'zod'

// ── Contract Metadata ──

export const contractMetaSchema = z.object({
  schemaVersion: z.string().default('2.0'),
  contractVersion: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  sourceRunId: z.number().int().positive(),
})
export type ContractMeta = z.infer<typeof contractMetaSchema>

// ── Source References ──

export const sourceRefSchema = z.object({
  blueprintHash: z.string().min(1),
  metadataRef: z.string().optional(),
  previousContractVersion: z.number().int().positive().optional(),
})
export type SourceRef = z.infer<typeof sourceRefSchema>

// ── Expected Entity ──

export const expectedEntitySchema = z.object({
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
  entityId: z.string().min(1),
  label: z.string().min(1).max(200),
  minCount: z.number().int().nonnegative().default(1),
  maxCount: z.number().int().nonnegative().default(1),
  parentRef: z.string().optional(),
  required: z.boolean().default(true),
})
export type ExpectedEntity = z.infer<typeof expectedEntitySchema>

// ── Relationship ──

export const relationshipSchema = z.object({
  type: z.enum(['parent_child', 'dependency', 'association']),
  sourceEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
  cardinality: z.enum(['one_to_one', 'one_to_many', 'many_to_many']).default('one_to_many'),
  description: z.string().default(''),
})
export type Relationship = z.infer<typeof relationshipSchema>

// ── Quality Gate ──

export const qualityGateSchema = z.object({
  gateId: z.string().min(1),
  gateType: z.enum([
    'schema_validation',
    'contract_validation',
    'reference_integrity',
    'custom_validator',
  ]),
  description: z.string().default(''),
  required: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
})
export type QualityGate = z.infer<typeof qualityGateSchema>

// ── Content Hash ──

/**
 * GenerationContract 内容的 SHA-256 哈希。
 * 用于快速判断 Contract 变化：版本变更 + hash 同时检测。
 */
export const contentHashSchema = z.string().length(64)
export type ContentHash = z.infer<typeof contentHashSchema>

// ── GenerationContract ──

/**
 * GenerationContract —— 编译运行前由确定性 Compiler 生成的内容契约。
 *
 * 包含应该生成什么（预期实体/关系）、质量门禁和来源引用。
 * LLM 只读：所有 Stage 只能引用 Contract 中的实体定义，
 * 不得创建、修改或删除 Contract 中的条目。
 */
export const generationContractSchema = z.object({
  meta: contractMetaSchema,
  sourceRefs: sourceRefSchema,
  expectedEntities: z.array(expectedEntitySchema).min(1),
  relationships: z.array(relationshipSchema).default([]),
  qualityGates: z.array(qualityGateSchema).default([]),
  contentHash: contentHashSchema,
})
export type GenerationContract = z.infer<typeof generationContractSchema>

// ── Contract Change Diff ──

/**
 * Contract 版本间差异摘要。
 * 用于版本化重编译时记录变更。
 */
export const contractChangeDiffSchema = z.object({
  previousVersion: z.number().int().positive(),
  newVersion: z.number().int().positive(),
  addedEntityIds: z.array(z.string()).default([]),
  removedEntityIds: z.array(z.string()).default([]),
  modifiedEntityIds: z.array(z.string()).default([]),
  changedRelationships: z.array(z.string()).default([]),
  summary: z.string().default(''),
})
export type ContractChangeDiff = z.infer<typeof contractChangeDiffSchema>
