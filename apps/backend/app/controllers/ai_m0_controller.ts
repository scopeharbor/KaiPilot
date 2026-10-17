/**
 * ai-structured-output-poc / M0 + ai-gateway-abstraction —— dev-only sandbox 控制器。
 *
 * 挂在 `/api/v1/dev/ai-m0/*` 下,只处理 HTTP 解析与 SSE 流式输出格式化。
 * 所有生成 / 判定 / 覆盖率检查逻辑下沉到 `services/ai_m0/*`。
 *
 * 三个端点:
 *   - GET  `/dev/ai-m0/inputs`:返回评测集清单与 inputSetHash;
 *   - POST `/dev/ai-m0/generate/once`:非流式一次生成,返回完整草案 + judge 结果;
 *   - POST `/dev/ai-m0/generate/stream`:SSE 流式生成,Last-Event-ID 语义。
 *
 * ai-gateway-abstraction:生成接受可选 `connectionId`,经 resolveAdapter 按连接实例化 Adapter
 * (DB 驱动,自研双协议);缺省/不可用回退 env 默认。策略据连接 capabilities 自动降级。
 *
 * spec 红线 1:本控制器绝不写正式数据,任何草案只回给前端展示,不入库。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { resolveAdapter } from '#services/ai_m0/resolver'
import { resolveStrategy } from '#services/ai_connection_service'
import { judgeOutcome } from '#services/ai_m0/judge'
import { draftJsonSchemaForStrategy } from '#services/ai_m0/schema'
import { AI_M0_INPUT_CASES, hashInputCases } from '#services/ai_m0/inputs'
import { aiM0StreamSessions } from '#services/ai_m0/stream_session_service'
import { AI_M0_STRATEGIES, AI_M0_THRESHOLDS } from '@aiproj/types'
import { z } from 'zod'

/** 请求体校验。策略必须来自 AI_M0_STRATEGIES;sentence 非空;connectionId 可选(缺省走回退)。 */
const generateBody = z.object({
  sentence: z.string().min(4).max(2000),
  strategy: z.enum(AI_M0_STRATEGIES),
  inputId: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  connectionId: z.number().int().positive().optional(),
  streamId: z.string().uuid().optional(),
})

export default class AiM0Controller {
  /** GET /api/v1/dev/ai-m0/inputs */
  async listInputs({ response }: HttpContext) {
    return response.ok({
      data: AI_M0_INPUT_CASES,
      meta: {
        inputSetHash: hashInputCases(),
        strategies: AI_M0_STRATEGIES,
        thresholds: AI_M0_THRESHOLDS,
      },
    })
  }

  /** POST /api/v1/dev/ai-m0/generate/once */
  async generateOnce(ctx: HttpContext) {
    const { request, response } = ctx
    const parsed = generateBody.safeParse(request.body())
    if (!parsed.success) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'invalid generate payload',
          details: parsed.error.issues,
        },
      })
    }
    const resolved = await resolveAdapter({
      connectionId: parsed.data.connectionId,
      organizationId: ctx.tenant?.organizationId ? Number(ctx.tenant.organizationId) : null,
    })
    const gateway = resolved.gateway
    const inputCase = parsed.data.inputId
      ? AI_M0_INPUT_CASES.find((c) => c.id === parsed.data.inputId)
      : undefined
    const expected =
      inputCase?.expectedRequiredInferredFields ??
      AI_M0_INPUT_CASES[0].expectedRequiredInferredFields
    // 策略降级:据连接 capabilities 把请求策略降到端点支持的(spec「strict 不可用时降级」)。
    const strategy = resolveStrategy(parsed.data.strategy, resolved.capabilities ?? null)
    const jsonSchema = draftJsonSchemaForStrategy(strategy)

    const result = await gateway.generate({
      sentence: parsed.data.sentence,
      strategy,
      temperature: parsed.data.temperature,
      jsonSchema,
    })
    const judged = judgeOutcome({
      rawText: result.rawText,
      triggeredErrorsFromAdapter: result.triggeredErrors,
      expectedRequiredInferredFields: expected,
    })

    return response.ok({
      data: {
        bucket: judged.bucket,
        draft: judged.draft,
        markerCoverage: judged.markerCoverage,
        missingMarkerFields: judged.missingMarkerFields,
        appliedFixes: judged.appliedFixes,
        triggeredErrors: judged.triggeredErrors,
        firstTokenMs: result.firstTokenMs,
        totalMs: result.totalMs,
        usingRealAdapter: result.usingRealAdapter,
        provider: gateway.provider,
        model: gateway.model,
        source: resolved.source,
        unavailable: resolved.unavailable ?? false,
        requestedStrategy: parsed.data.strategy,
        effectiveStrategy: strategy,
      },
    })
  }

  /** POST /api/v1/dev/ai-m0/generate/stream */
  async generateStream(ctx: HttpContext) {
    const { request, response } = ctx
    const parsed = generateBody.safeParse(request.body())
    if (!parsed.success) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'invalid generate payload',
          details: parsed.error.issues,
        },
      })
    }
    let streamId = parsed.data.streamId
    if (!streamId) {
      const resolved = await resolveAdapter({
        connectionId: parsed.data.connectionId,
        organizationId: ctx.tenant?.organizationId ? Number(ctx.tenant.organizationId) : null,
      })
      const gateway = resolved.gateway
      const strategy = resolveStrategy(parsed.data.strategy, resolved.capabilities ?? null)
      const inputCase =
        AI_M0_INPUT_CASES.find((item) => item.id === parsed.data.inputId) ?? AI_M0_INPUT_CASES[0]
      streamId = aiM0StreamSessions.start({
        gateway,
        generate: {
          sentence: parsed.data.sentence,
          strategy,
          temperature: parsed.data.temperature,
          jsonSchema: draftJsonSchemaForStrategy(strategy),
        },
        finish: ({ rawText, triggeredErrors, firstTokenMs, totalMs }) => {
          const judged = judgeOutcome({
            rawText,
            triggeredErrorsFromAdapter: triggeredErrors,
            expectedRequiredInferredFields: inputCase.expectedRequiredInferredFields,
          })
          return {
            bucket: judged.bucket,
            markerCoverage: judged.markerCoverage,
            missingMarkerFields: judged.missingMarkerFields,
            appliedFixes: judged.appliedFixes,
            triggeredErrors: judged.triggeredErrors,
            firstTokenMs,
            totalMs,
            usingRealAdapter: gateway.usingRealAdapter,
            provider: gateway.provider,
            model: gateway.model,
            source: resolved.source,
            unavailable: resolved.unavailable ?? false,
            requestedStrategy: parsed.data.strategy,
            effectiveStrategy: strategy,
          }
        },
      })
    } else {
      // 在写出 SSE headers 前验证，过期时返回统一 JSON 410。
      aiM0StreamSessions.read(streamId, Number(request.header('last-event-id') ?? 0))
    }

    const raw = response.response
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache, no-transform')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('X-Accel-Buffering', 'no')
    raw.setHeader('X-AI-M0-Stream-ID', streamId)
    raw.flushHeaders?.()

    const lastEventId = request.header('last-event-id') ?? '0'
    let cursor = Number(lastEventId) || 0
    try {
      while (!raw.destroyed) {
        const events = aiM0StreamSessions.read(streamId, cursor)
        for (const event of events) {
          raw.write(`id: ${event.seq}\n`)
          raw.write(`event: ${event.event}\n`)
          raw.write(`data: ${JSON.stringify(event.data)}\n\n`)
          cursor = event.seq
        }
        if (aiM0StreamSessions.isComplete(streamId)) break
        await aiM0StreamSessions.waitForChange(streamId)
      }
    } finally {
      raw.end()
    }
  }
}
