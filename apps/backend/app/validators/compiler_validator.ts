/**
 * v2-project-compiler-foundation —— CompilerValidator（tasks 8.2）。
 *
 * 校验发起编译入参与查询参数。
 */
import { z } from 'zod'
import type { HttpContext } from '@adonisjs/core/http'

/** 发起编译请求体 Schema（v3-template-compiler-plugin-integration：增加 templateSelection）。 */
export const startRunBodySchema = z.object({
  input: z.object({
    text: z.string().min(1).max(10000),
    projectType: z.string().optional(),
  }),
  idempotencyKey: z.string().max(255).optional(),
  templateSelection: z
    .object({
      templateId: z.string().regex(/^ptpl_[a-z0-9_]+$/, 'templateId must match ^ptpl_[a-z0-9_]+$'),
      selectionDigest: z.string().min(1).max(128),
    })
    .optional(),
  blueprints: z
    .array(
      z.object({
        stageId: z.string().min(1),
        phase: z.string().min(1),
        dependsOn: z.array(z.string()).optional().default([]),
        parallelGroup: z.string().optional(),
        entities: z
          .array(
            z.object({
              entityId: z.string().min(1),
              kind: z.string().min(1),
            }),
          )
          .optional()
          .default([]),
      }),
    )
    .optional(),
})

export type StartRunBody = z.infer<typeof startRunBodySchema>

/** 查询参数 Schema。 */
export const runQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  perPage: z.coerce.number().int().positive().max(100).optional().default(50),
  stageId: z.string().optional(),
})

export type RunQuery = z.infer<typeof runQuerySchema>

/** 路径参数 Schema。 */
export const runIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export type RunIdParam = z.infer<typeof runIdParamSchema>

/**
 * 在 Controller 中使用的快捷验证函数。
 */
export function validateStartRunBody(ctx: HttpContext) {
  const parsed = startRunBodySchema.safeParse(ctx.request.body())
  if (!parsed.success) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid compiler run request',
        details: parsed.error.issues,
      },
    })
    return null
  }
  return parsed.data
}

export function validateQuery(ctx: HttpContext): RunQuery {
  const parsed = runQuerySchema.safeParse(ctx.request.qs())
  if (!parsed.success) {
    return { page: 1, perPage: 50 }
  }
  return parsed.data
}

export function validateRunId(ctx: HttpContext): number | null {
  const parsed = runIdParamSchema.safeParse(ctx.request.params())
  if (!parsed.success) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid run ID',
        details: parsed.error.issues,
      },
    })
    return null
  }
  return parsed.data.id
}
