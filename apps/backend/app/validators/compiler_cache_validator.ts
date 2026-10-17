/**
 * v2-5-compiler-cache-management-api（tasks 5.1）—— CompilerCacheValidator。
 *
 * 校验失效范围枚举、必填参数（stage 范围必带 stageId）、显式确认参数，
 * 并以 `.strict()` 结构性拒绝任意键/前缀匹配尝试（design D6：只接受受控枚举，不接受 keyGlob/keyPrefix）。
 *
 * 采用 zod，与姊妹 `compiler_routing_validator` 一致（编译器子系统统一 Validator 约定；
 * spec 只要求「Validator 校验范围枚举与必填参数」，未强制具体校验库）。
 */
import { z } from 'zod'
import type { HttpContext } from '@adonisjs/core/http'
import {
  CACHE_INVALIDATION_SCOPES,
  cacheResponseContainsSensitiveFields,
  type CacheInvalidationScope,
} from '@aiproj/types/compiler-cache-management'

// ── 失效范围请求 Schema（preview 与 invalidation 共用基） ──

const SAFE_CACHE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/

export const safeCacheIdentifierSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(SAFE_CACHE_IDENTIFIER_PATTERN, '仅允许字母、数字、下划线、短横线和点')

const scopeRequestShape = {
  // 缩窄枚举到字面量联合（CacheInvalidationScope），使 z.infer 得到联合类型而非 string，
  // 从而与 service/DTO 的 `scope: CacheInvalidationScope` 契约对齐。运行时值不变。
  scope: z.enum(
    CACHE_INVALIDATION_SCOPES as unknown as [CacheInvalidationScope, ...CacheInvalidationScope[]],
  ),
  stageId: safeCacheIdentifierSchema.optional(),
  cachePolicyVersion: safeCacheIdentifierSchema.optional(),
}

/** stage 范围必带 stageId 的公共细化。 */
function requireStageId<T extends { scope: string; stageId?: string }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (data.scope === 'stage' && (!data.stageId || data.stageId.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['stageId'],
      message: 'stage 范围必须提供 stageId',
    })
  }
}

export const cacheInvalidationScopeRequestSchema = z
  .object(scopeRequestShape)
  .strict()
  .superRefine(requireStageId)

export type CacheInvalidationScopeRequestBody = z.infer<typeof cacheInvalidationScopeRequestSchema>

// ── 失效写入请求 Schema（受控，需显式确认） ──

export const cacheInvalidationRequestSchema = z
  .object({
    ...scopeRequestShape,
    confirm: z.boolean(),
  })
  .strict()
  .superRefine(requireStageId)

export type CacheInvalidationRequestBody = z.infer<typeof cacheInvalidationRequestSchema>

// ── Controller 快捷验证函数 ──

/** 校验只读失效预览请求（切片 2）。非法 → VALIDATION_ERROR + null。 */
export function validateInvalidationPreviewRequest(
  ctx: HttpContext,
): CacheInvalidationScopeRequestBody | null {
  return runValidation(
    ctx,
    cacheInvalidationScopeRequestSchema,
    'Invalid cache invalidation preview request',
  )
}

/** 校验受控失效写入请求（切片 3）。非法 → VALIDATION_ERROR + null。 */
export function validateInvalidationRequest(ctx: HttpContext): CacheInvalidationRequestBody | null {
  return runValidation(ctx, cacheInvalidationRequestSchema, 'Invalid cache invalidation request')
}

/** 校验 GET /cache?stageId= 查询参数，避免 Redis SCAN MATCH 通配符被当作隐式 key glob。 */
export function validateOptionalStageIdQuery(ctx: HttpContext): string | undefined | null {
  const rawStageId = ctx.request.qs().stageId
  if (rawStageId === undefined || rawStageId === null || rawStageId === '') return undefined
  if (typeof rawStageId !== 'string') {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid cache inventory query',
        details: [{ path: ['stageId'], message: 'stageId must be a string' }],
      },
    })
    return null
  }

  const parsed = safeCacheIdentifierSchema.safeParse(rawStageId)
  if (!parsed.success) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid cache inventory query',
        details: parsed.error.issues,
      },
    })
    return null
  }

  return parsed.data
}

function runValidation<T>(
  ctx: HttpContext,
  schema: z.ZodType<T>,
  invalidMessage: string,
): T | null {
  const parsed = schema.safeParse(ctx.request.body())
  if (!parsed.success) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: invalidMessage,
        details: parsed.error.issues,
      },
    })
    return null
  }

  // 低敏守卫：拒绝混入缓存值正文/raw key/prompt/token 等敏感字段。
  const sensitive = cacheResponseContainsSensitiveFields(parsed.data)
  if (sensitive.found) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Request contains sensitive field: ${sensitive.fieldPath}`,
      },
    })
    return null
  }

  return parsed.data
}
