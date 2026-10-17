/**
 * v3-ocr-provider-observability-cost-controls — OCR provider observability 控制器。
 *
 * 项目级只读 API：摘要与 bounded 事件列表。
 * 所有端点强制组织/项目隔离 + RBAC 策略 + 低敏脱敏。
 */

import type { HttpContext } from '@adonisjs/core/http'
import OcrProviderAttemptRecorder from '#services/ai_ocr/ocr_provider_attempt_recorder'
import OcrProviderObservabilityPolicy from '#policies/ocr_provider_observability_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import { OcrDownstreamGuard } from '#services/ai_ocr/ocr_downstream_guard'
import { redactOcrProviderObservabilityMetadata } from '@aiproj/types'
import { ocrProviderObservabilityEventsSchema } from '#validators/ocr_provider_observability'

export default class OcrProviderObservabilityController {
  readonly #recorder = new OcrProviderAttemptRecorder()
  readonly #audit = new AuditService()
  readonly #guard = new OcrDownstreamGuard(this.#audit)

  /**
   * 项目级 provider 边界守卫：在暴露 observability 摘要前解析 `provider_run` 决策。
   * 被拒 → 写低敏边界审计并阻止（不暴露原始 provider 载荷）。
   */
  private async guardProviderUsage(
    user: { id: number },
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    await this.#guard.guard({
      actorId: user.id,
      organizationId,
      projectId,
      action: 'provider_run',
      sourceRef: { type: 'ocr_source', id: projectId, kind: 'job' },
    })
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/provider-observability/summary
   * 项目级 OCR provider observability 只读摘要。
   */
  async summary(ctx: HttpContext) {
    const { auth, params } = ctx
    const user = auth.user!
    const organizationId = (user as any).organizationId as number
    const projectId = Number(params.projectId)

    // RBAC
    await new OcrProviderObservabilityPolicy().view(ctx)

    // 权限守卫（§6.3）
    await this.guardProviderUsage(user, organizationId, projectId)

    const summary = await this.#recorder.getSummary(organizationId, projectId)

    await this.#audit.log({
      event: AuditEvent.OCR_PROVIDER_COST_SUMMARY_READ,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'ocr_provider_observability_summary',
      entityId: 0,
      metadata: redactOcrProviderObservabilityMetadata({
        totalAttempts: summary.totalAttempts,
        totalEstimatedCost: summary.totalEstimatedCost,
        costStatus: summary.costStatus,
      }),
    })

    return ctx.response.json({ data: summary })
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/provider-observability/events
   * 项目级 OCR provider observability 事件列表（bounded）。
   */
  async events(ctx: HttpContext) {
    const { auth, params, request } = ctx
    const user = auth.user!
    const organizationId = (user as any).organizationId as number
    const projectId = Number(params.projectId)

    // RBAC
    await new OcrProviderObservabilityPolicy().view(ctx)

    // 权限守卫（§6.3）
    await this.guardProviderUsage(user, organizationId, projectId)

    const payload = await request.validateUsing(ocrProviderObservabilityEventsSchema)
    const result = await this.#recorder.listEvents(organizationId, projectId, {
      ocrJobId: payload.ocrJobId ?? null,
      provider: payload.provider ?? null,
      model: payload.model ?? null,
      status: (payload.status as any) ?? null,
      errorCategory: (payload.errorCategory as any) ?? null,
      timeWindowStart: payload.timeWindowStart ?? null,
      timeWindowEnd: payload.timeWindowEnd ?? null,
      page: payload.page ?? 1,
      perPage: payload.perPage ?? 20,
    })

    await this.#audit.log({
      event: AuditEvent.OCR_PROVIDER_OBSERVABILITY_READ,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'ocr_provider_observability_events',
      entityId: 0,
      metadata: redactOcrProviderObservabilityMetadata({
        total: result.meta.total,
        page: result.meta.page,
        filters: {
          ocrJobId: payload.ocrJobId ?? null,
          provider: payload.provider ?? null,
          status: payload.status ?? null,
        },
      }),
    })

    return ctx.response.json({ data: result.data, meta: result.meta })
  }
}
