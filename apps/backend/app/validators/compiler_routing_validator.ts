/**
 * v2-5-compiler-dynamic-routing-management-ui（tasks 4.2/5.5）—— CompilerRoutingValidator。
 *
 * 校验模拟请求（scenario kind 枚举、候选 stage 为已声明 stage、低敏输入）
 * 与规则写校验（稳定 id/version、仅引用已声明 stage、低敏 reason code、拒绝非确定性/读敏感字段）。
 */
import { z } from 'zod'
import type { HttpContext } from '@adonisjs/core/http'
import {
  COMPILER_SCENARIO_KINDS,
  ROUTING_REASON_CODES,
  routingResponseContainsSensitiveFields,
} from '@aiproj/types/compiler-dynamic-routing'

const KNOWN_STAGE_IDS = new Set(['intent_ingestion', 'intent_parsing', 'dag_stub'])

// ── 模拟请求 Schema（切片 C） ──

export const routingSimulateRequestSchema = z.object({
  scenarioKind: z.enum(COMPILER_SCENARIO_KINDS),
  candidateStageIds: z.array(z.string().min(1)).min(1),
  availableHandlerStageIds: z.array(z.string().min(1)),
  contractVersion: z.string().min(1),
  dependencies: z.array(
    z.object({
      stageId: z.string().min(1),
      dependsOn: z.array(z.string()),
    }),
  ),
})

export type RoutingSimulateRequestBody = z.infer<typeof routingSimulateRequestSchema>

// ── 规则编排请求 Schema（切片 B） ──

export const routingRuleAuthoringRequestSchema = z.object({
  id: z.string().min(1).max(80),
  version: z.object({
    major: z.number().int().nonnegative(),
    minor: z.number().int().nonnegative(),
  }),
  compatibleContracts: z.object({
    min: z.string().min(1),
    max: z.string().min(1),
  }),
  scenarioKinds: z.array(z.enum(COMPILER_SCENARIO_KINDS)).min(1),
  allowedStageIds: z.array(z.string()),
  allowedSkippedStageIds: z.array(z.string()),
  reasonCode: z.enum(ROUTING_REASON_CODES),
  isDefault: z.boolean().optional().default(false),
  enabled: z.boolean(),
})

export type RoutingRuleAuthoringRequestBody = z.infer<typeof routingRuleAuthoringRequestSchema>

// ── 确认请求 Schema（切片 B） ──

export const routingRuleConfirmRequestSchema = z.object({
  confirmToken: z.string().min(1),
})

export type RoutingRuleConfirmRequestBody = z.infer<typeof routingRuleConfirmRequestSchema>

// ── Controller 快捷验证函数 ──

export function validateSimulateRequest(ctx: HttpContext): RoutingSimulateRequestBody | null {
  const parsed = routingSimulateRequestSchema.safeParse(ctx.request.body())
  if (!parsed.success) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid routing simulate request',
        details: parsed.error.issues,
      },
    })
    return null
  }

  // 额外校验：候选 stage 为已声明 stage
  const unknownStages = parsed.data.candidateStageIds.filter((s) => !KNOWN_STAGE_IDS.has(s))
  if (unknownStages.length > 0) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Unknown stage IDs in candidate plan: ${unknownStages.join(', ')}`,
      },
    })
    return null
  }

  // 敏感字段守卫
  const sensitive = routingResponseContainsSensitiveFields(parsed.data)
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

export function validateRuleAuthoringRequest(
  ctx: HttpContext,
): RoutingRuleAuthoringRequestBody | null {
  const parsed = routingRuleAuthoringRequestSchema.safeParse(ctx.request.body())
  if (!parsed.success) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid routing rule authoring request',
        details: parsed.error.issues,
      },
    })
    return null
  }

  // 仅引用已声明 stage
  const allStageIds = [...parsed.data.allowedStageIds, ...parsed.data.allowedSkippedStageIds]
  const unknownStages = allStageIds.filter((s) => !KNOWN_STAGE_IDS.has(s))
  if (unknownStages.length > 0) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Rule references unknown stage IDs: ${unknownStages.join(', ')}`,
      },
    })
    return null
  }

  // 敏感字段守卫
  const sensitive = routingResponseContainsSensitiveFields(parsed.data)
  if (sensitive.found) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Rule contains sensitive field: ${sensitive.fieldPath}`,
      },
    })
    return null
  }

  return parsed.data
}

export function validateRuleConfirmRequest(ctx: HttpContext): RoutingRuleConfirmRequestBody | null {
  const parsed = routingRuleConfirmRequestSchema.safeParse(ctx.request.body())
  if (!parsed.success) {
    ctx.response.badRequest({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid confirmation request',
        details: parsed.error.issues,
      },
    })
    return null
  }
  return parsed.data
}
