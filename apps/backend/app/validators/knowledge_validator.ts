/**
 * v3-four-layer-knowledge-system —— KnowledgeItem Validators。
 *
 * 校验知识记录的 create/update/query/structure 请求。
 * 使用 zod（遵循 compiler_skill_validator 约定）。
 *
 * @aiproj/backend
 */
import { z } from 'zod'
import type { HttpContext } from '@adonisjs/core/http'
import { KNOWLEDGE_LAYERS, KNOWLEDGE_LIFECYCLE_STATUSES } from '@aiproj/types'
import type { KnowledgeLayer, KnowledgeLifecycleStatus } from '@aiproj/types'

// ── 辅助 schema ──────────────────────────────────────────────────

const sourceRefSchema = z.object({
  layer: z.enum(KNOWLEDGE_LAYERS as unknown as [KnowledgeLayer, ...KnowledgeLayer[]]),
  sourceId: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  section: z.string().max(255).optional(),
  url: z.string().url().optional(),
  retrievedAt: z.string().optional(),
  isSynthetic: z.boolean().optional(),
  syntheticMethod: z.string().max(500).optional(),
})

const provenanceSchema = z.object({
  sources: z.array(sourceRefSchema).min(1, 'provenance.sources 至少需要一条来源引用'),
})

// ── 创建请求 ─────────────────────────────────────────────────────

export const createKnowledgeSchema = z.object({
  layer: z.enum(
    KNOWLEDGE_LAYERS.filter((l) => l !== 'L3'),
    {
      message: '只可手动创建 L1/L2 知识；L3 由合成治理 Service 负责',
    },
  ),
  title: z.string().min(1).max(500),
  content: z.union([z.record(z.string(), z.unknown()), z.string()]),
  domain: z.string().min(1).max(128),
  purpose: z.string().min(1).max(128),
  complexity: z.string().max(64).optional(),
  provenance: provenanceSchema,
})

export type CreateKnowledgeBody = z.infer<typeof createKnowledgeSchema>

// ── 更新请求 ─────────────────────────────────────────────────────

export const updateKnowledgeSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
  domain: z.string().min(1).max(128).optional(),
  purpose: z.string().min(1).max(128).optional(),
  complexity: z.string().max(64).optional(),
  provenance: provenanceSchema.optional(),
})

export type UpdateKnowledgeBody = z.infer<typeof updateKnowledgeSchema>

// ── 检索查询 ─────────────────────────────────────────────────────

export const queryKnowledgeSchema = z.object({
  layer: z.enum(KNOWLEDGE_LAYERS as unknown as [KnowledgeLayer, ...KnowledgeLayer[]]).optional(),
  domain: z.string().max(128).optional(),
  purpose: z.string().max(128).optional(),
  complexity: z.string().max(64).optional(),
  // 状态过滤（api-contract 冻结点：未指定时默认 active，由存储层兜底）
  status: z
    .enum(
      KNOWLEDGE_LIFECYCLE_STATUSES as unknown as [
        KnowledgeLifecycleStatus,
        ...KnowledgeLifecycleStatus[],
      ],
    )
    .optional(),
  keyword: z.string().max(500).optional(),
  evalContext: z.boolean().optional().default(false),
  // HTTP query 参数一律是字符串，coerce 兼容契约里的 number 语义
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export type QueryKnowledgeBody = z.infer<typeof queryKnowledgeSchema>

// ── 生命周期转移 ─────────────────────────────────────────────────

export const lifecycleTransitionSchema = z.object({
  status: z.enum(
    KNOWLEDGE_LIFECYCLE_STATUSES as unknown as [
      KnowledgeLifecycleStatus,
      ...KnowledgeLifecycleStatus[],
    ],
  ),
})

export type LifecycleTransitionBody = z.infer<typeof lifecycleTransitionSchema>

// ── AI 结构化请求 ────────────────────────────────────────────────

export const aiStructureKnowledgeSchema = z.object({
  rawText: z.string().min(1).max(50000),
  targetLayer: z.enum(['L1', 'L2'] as const),
  domain: z.string().max(128).optional(),
  purpose: z.string().max(128).optional(),
})

export type AiStructureKnowledgeBody = z.infer<typeof aiStructureKnowledgeSchema>

// ── Controller 快捷验证 ──────────────────────────────────────────

function runValidation<T>(ctx: HttpContext, schema: z.ZodType<T>, message: string): T | null {
  const parsed = schema.safeParse(ctx.request.body())
  if (!parsed.success) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message,
        details: parsed.error.issues,
      },
    })
    return null
  }
  return parsed.data
}

export function validateCreateKnowledge(ctx: HttpContext): CreateKnowledgeBody | null {
  return runValidation(ctx, createKnowledgeSchema, 'Invalid create knowledge request')
}

export function validateUpdateKnowledge(ctx: HttpContext): UpdateKnowledgeBody | null {
  return runValidation(ctx, updateKnowledgeSchema, 'Invalid update knowledge request')
}

export function validateQueryKnowledge(ctx: HttpContext): QueryKnowledgeBody | null {
  // 检索是 GET：query 参数在 qs 而非 body（Adonis `request.body()` 只含请求体）。
  // `all()` = body + qs 合并，覆盖两种调用方式。
  const parsed = queryKnowledgeSchema.safeParse(ctx.request.all())
  if (!parsed.success) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid knowledge query',
        details: parsed.error.issues,
      },
    })
    return null
  }
  return parsed.data
}

export function validateLifecycleTransition(ctx: HttpContext): LifecycleTransitionBody | null {
  return runValidation(ctx, lifecycleTransitionSchema, 'Invalid lifecycle transition request')
}

export function validateAiStructureKnowledge(ctx: HttpContext): AiStructureKnowledgeBody | null {
  return runValidation(ctx, aiStructureKnowledgeSchema, 'Invalid AI structure request')
}
