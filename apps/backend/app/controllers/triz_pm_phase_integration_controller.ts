import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizPmPhaseIntegrationService from '#services/triz_pm_phase_integration_service'
import TrizPmPhaseIntegrationPolicy from '#policies/triz_pm_phase_integration_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  createRunValidator,
  listRunsValidator,
  reviewPhaseValidator,
  explainPhaseValidator,
  handoffPreviewValidator,
} from '#validators/triz_pm_phase_integration_validator'
import { errors } from '@vinejs/vine'

/**
 * TRIZ-PM 阶段整合 Controller（v3-triz-pm-phase-integration §5.2）。
 *
 * 8 个端点：createRun / listRuns / getRun / listPhases / getPhase /
 * reviewPhase / explainPhase / handoffPreview。
 * 所有端点强制 JWT + 组织隔离 + RBAC + 低敏审计。
 */
@inject()
export default class TrizPmPhaseIntegrationController {
  constructor(
    private service: TrizPmPhaseIntegrationService,
    private policy: TrizPmPhaseIntegrationPolicy,
    private auditService: AuditService,
  ) {}

  // ── POST / → createRun ──────────────────────────────────────────────────

  async createRun(ctx: HttpContext) {
    const { request, response, params, auth } = ctx
    try {
      await this.policy.createRun(ctx)
    } catch {
      await this.auditService.log({
        event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_PERMISSION_DENIED,
        userId: auth.user?.id ?? 0,
        organizationId: ctx.tenant?.organizationId ?? 0,
        projectId: Number(params.projectId),
        entityType: 'triz_pm_phase_integration_run',
        entityId: 0,
        metadata: { reason: 'create_run_permission_denied' },
      })
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权创建阶段整合分析' },
      })
    }

    try {
      const payload = await request.validateUsing(createRunValidator)
      const { run } = await this.service.createRun(
        ctx.tenant!.organizationId,
        Number(params.projectId),
        auth.user!.id,
        payload.userNotes,
      )
      return response.json({ data: run })
    } catch (err) {
      if (err instanceof errors.E_VALIDATION_ERROR) {
        return response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: '请求参数无效', details: err.messages },
        })
      }
      throw err
    }
  }

  // ── GET / → listRuns ────────────────────────────────────────────────────

  async listRuns(ctx: HttpContext) {
    const { request, response, params } = ctx
    try {
      await this.policy.view(ctx)
    } catch {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看阶段整合分析' },
      })
    }

    try {
      const qs = await request.validateUsing(listRunsValidator)
      const result = await this.service.listRuns(
        ctx.tenant!.organizationId,
        Number(params.projectId),
        qs.page,
        qs.perPage,
        qs.sort,
        qs.status,
      )
      return response.json({ data: result.data, meta: result.meta })
    } catch (err) {
      if (err instanceof errors.E_VALIDATION_ERROR) {
        return response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: '请求参数无效' },
        })
      }
      throw err
    }
  }

  // ── GET /:runId → getRun ────────────────────────────────────────────────

  async getRun(ctx: HttpContext) {
    const { params, response } = ctx
    try {
      await this.policy.view(ctx)
    } catch {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看阶段整合分析' },
      })
    }

    const run = await this.service.getRun(
      ctx.tenant!.organizationId,
      Number(params.projectId),
      Number(params.runId),
    )

    if (!run) {
      return response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '阶段整合运行不存在' },
      })
    }

    return response.json({ data: run })
  }

  // ── GET /:runId/phases → listPhases ─────────────────────────────────────

  async listPhases(ctx: HttpContext) {
    const { params, response } = ctx
    try {
      await this.policy.view(ctx)
    } catch {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看阶段快照' },
      })
    }

    const phases = await this.service.listPhases(
      ctx.tenant!.organizationId,
      Number(params.projectId),
      Number(params.runId),
    )

    return response.json({
      data: phases,
      meta: { total: phases.length, page: 1, perPage: phases.length, totalPages: 1 },
    })
  }

  // ── GET /:runId/phases/:phaseId → getPhase ──────────────────────────────

  async getPhase(ctx: HttpContext) {
    const { params, response } = ctx
    try {
      await this.policy.view(ctx)
    } catch {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看阶段详情' },
      })
    }

    const phase = await this.service.getPhase(
      ctx.tenant!.organizationId,
      Number(params.projectId),
      Number(params.runId),
      params.phaseId,
    )

    if (!phase) {
      return response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '阶段快照不存在' },
      })
    }

    return response.json({ data: phase })
  }

  // ── POST /:runId/review → reviewPhase ───────────────────────────────────

  async reviewPhase(ctx: HttpContext) {
    const { request, params, response, auth } = ctx
    try {
      await this.policy.review(ctx)
    } catch {
      await this.auditService.log({
        event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_PERMISSION_DENIED,
        userId: auth.user?.id ?? 0,
        organizationId: ctx.tenant?.organizationId ?? 0,
        projectId: Number(params.projectId),
        entityType: 'triz_pm_phase_snapshot',
        entityId: 0,
        metadata: { reason: 'review_permission_denied' },
      })
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权记录阶段审查' },
      })
    }

    try {
      const payload = await request.validateUsing(reviewPhaseValidator)
      const phase = await this.service.reviewPhase(
        ctx.tenant!.organizationId,
        Number(params.projectId),
        auth.user!.id,
        Number(params.runId),
        payload.phaseId,
        payload.reviewNotes,
      )
      return response.json({ data: phase })
    } catch (err) {
      if (err instanceof errors.E_VALIDATION_ERROR) {
        return response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: '请求参数无效' },
        })
      }
      throw err
    }
  }

  // ── POST /:runId/explain → explainPhase ─────────────────────────────────

  async explainPhase(ctx: HttpContext) {
    const { request, params, response, auth } = ctx
    try {
      await this.policy.explain(ctx)
    } catch {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权生成 AI 说明' },
      })
    }

    try {
      const payload = await request.validateUsing(explainPhaseValidator)
      const explanation = await this.service.explainPhase(
        ctx.tenant!.organizationId,
        Number(params.projectId),
        auth.user!.id,
        Number(params.runId),
        payload.phaseId,
        // 默认不注入 AI provider → 确定性 fallback
        undefined,
      )
      return response.json({ data: explanation })
    } catch (err) {
      if (err instanceof errors.E_VALIDATION_ERROR) {
        return response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: '请求参数无效' },
        })
      }
      throw err
    }
  }

  // ── POST /:runId/handoff-preview → handoffPreview ───────────────────────

  async handoffPreview(ctx: HttpContext) {
    const { request, params, response, auth } = ctx
    try {
      await this.policy.preview(ctx)
    } catch {
      await this.auditService.log({
        event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_PERMISSION_DENIED,
        userId: auth.user?.id ?? 0,
        organizationId: ctx.tenant?.organizationId ?? 0,
        projectId: Number(params.projectId),
        entityType: 'triz_pm_phase_snapshot',
        entityId: 0,
        metadata: { reason: 'handoff_permission_denied' },
      })
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权创建 handoff preview' },
      })
    }

    try {
      const payload = await request.validateUsing(handoffPreviewValidator)
      const preview = await this.service.handoffPreview(
        ctx.tenant!.organizationId,
        Number(params.projectId),
        auth.user!.id,
        Number(params.runId),
        payload.phaseId,
        payload.recommendationId,
        payload.target,
      )
      return response.json({ data: preview })
    } catch (err) {
      if (err instanceof errors.E_VALIDATION_ERROR) {
        return response.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: '请求参数无效' },
        })
      }
      if ((err as any)?.code === 'STALE_BLOCKED') {
        return response.status(409).json({
          error: { code: 'STALE_BLOCKED', message: '来源数据已过期，请重新运行分析' },
        })
      }
      if ((err as any)?.message?.includes('not found')) {
        return response.status(404).json({
          error: { code: 'RESOURCE_NOT_FOUND', message: '阶段快照或推荐不存在' },
        })
      }
      throw err
    }
  }
}
