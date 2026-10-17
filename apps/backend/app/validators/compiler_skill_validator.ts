/**
 * v3-skill-registry-and-lifecycle —— CompilerSkill Validators。
 *
 * 校验 Skill create/update/lifecycle/match 请求。
 * 与编译器子系统统一使用 zod（遵循 compiler_cache/routing_validator 约定）。
 */
import { z } from 'zod'
import type { HttpContext } from '@adonisjs/core/http'
import {
  SKILL_LIFECYCLE_STATUSES,
  SKILL_CATEGORY_PRIMARY_TYPES,
  type SkillLifecycleStatus,
} from '@aiproj/types'

// ── 基础字段 schema ──────────────────────────────────────────────

const skillKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, 'skillKey 仅允许字母、数字、下划线、短横线和点')

const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/, 'version 必须是 semver 格式')

const categorySchema = z.object({
  primary: z.enum(SKILL_CATEGORY_PRIMARY_TYPES),
  secondary: z.string().max(128).optional(),
  tertiary: z.array(z.string().max(64)).max(20).optional(),
})

const activationSchema = z.object({
  stages: z.array(z.string().max(64)).max(50).optional(),
  projectTypes: z.array(z.string().max(64)).max(50).optional(),
  domains: z.array(z.string().max(64)).max(50).optional(),
  complexityRange: z
    .object({
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .optional(),
})

const knowledgeSchema = z
  .object({
    rules: z.array(z.unknown()).optional(),
    patterns: z.array(z.unknown()).optional(),
    antiPatterns: z.array(z.unknown()).optional(),
    examples: z.array(z.unknown()).optional(),
    checklists: z.array(z.unknown()).optional(),
    rubric: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  })
  .catchall(z.unknown())

const provenanceSchema = z
  .object({
    sourceSkillKey: z.string().max(128).optional(),
    sourceVersion: z.string().max(32).optional(),
    importedAt: z.string().optional(),
    importNote: z.string().max(500).optional(),
  })
  .nullable()
  .optional()

// ── 创建请求 ─────────────────────────────────────────────────────

export const createSkillSchema = z.object({
  skillKey: skillKeySchema,
  name: z.string().min(1).max(255),
  version: semverSchema,
  description: z.string().max(2000).default(''),
  category: categorySchema,
  tags: z.array(z.string().max(64)).max(50).default([]),
  activation: activationSchema.default({}),
  knowledge: knowledgeSchema.default({}),
  provenance: provenanceSchema,
  basePriority: z.number().int().min(1).max(10000).default(100),
})

export type CreateSkillBody = z.infer<typeof createSkillSchema>

// ── 更新请求（全部可选） ─────────────────────────────────────────

export const updateSkillSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  category: categorySchema.optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  activation: activationSchema.optional(),
  knowledge: knowledgeSchema.optional(),
  provenance: provenanceSchema,
  basePriority: z.number().int().min(1).max(10000).optional(),
})

export type UpdateSkillBody = z.infer<typeof updateSkillSchema>

// ── 生命周期转移 ────────────────────────────────────────────────

export const lifecycleTransitionSchema = z.object({
  status: z.enum(
    SKILL_LIFECYCLE_STATUSES as unknown as [SkillLifecycleStatus, ...SkillLifecycleStatus[]],
  ),
})

export type LifecycleTransitionBody = z.infer<typeof lifecycleTransitionSchema>

// ── 匹配查询 ────────────────────────────────────────────────────

export const skillMatchSchema = z.object({
  stageId: z.string().max(64).optional(),
  projectType: z.string().max(64).optional(),
  domains: z.array(z.string().max(64)).max(20).optional(),
  complexity: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional().default(10),
})

export type SkillMatchBody = z.infer<typeof skillMatchSchema>

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

export function validateCreateSkill(ctx: HttpContext): CreateSkillBody | null {
  return runValidation(ctx, createSkillSchema, 'Invalid create skill request')
}

export function validateUpdateSkill(ctx: HttpContext): UpdateSkillBody | null {
  return runValidation(ctx, updateSkillSchema, 'Invalid update skill request')
}

export function validateLifecycleTransition(ctx: HttpContext): LifecycleTransitionBody | null {
  return runValidation(ctx, lifecycleTransitionSchema, 'Invalid lifecycle transition request')
}

export function validateSkillMatch(ctx: HttpContext): SkillMatchBody | null {
  return runValidation(ctx, skillMatchSchema, 'Invalid skill match request')
}
