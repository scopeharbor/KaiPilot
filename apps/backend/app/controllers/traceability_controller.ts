/**
 * v2-traceability-source-attribution —— TraceabilityController（task 6.1）。
 *
 * HTTP 入口，只处理请求解析、权限校验、响应格式化。
 * 业务逻辑下沉到 SourceAttributionService / TraceabilityService。
 *
 * 红线：
 * - 禁止客户端指定 organizationId（从 tenant 获取）
 * - 跨组织访问返回 not-found，不泄漏存在性
 *
 * @aiproj/backend
 */

import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { SourceAttributionService } from '#services/compiler/traceability/source_attribution_service'
import { TraceabilityService } from '#services/compiler/traceability/traceability_service'
import TraceabilityPolicy from '#policies/traceability_policy'
import AuditService from '#services/audit_service'

@inject()
export default class TraceabilityController {
  constructor(
    private readonly attributionService: SourceAttributionService,
    private readonly traceabilityService: TraceabilityService,
    private readonly policy: TraceabilityPolicy,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /api/v1/compiler-runs/:runId/attributions —— 按 compiler run 查询 attributions。
   */
  async listByCompilerRun(ctx: HttpContext) {
    const { response, authUser, tenant, params } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewAttribution(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const runId = Number(params.runId)
    if (Number.isNaN(runId)) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid runId' },
      })
    }

    const attributions = await this.attributionService.listByCompilerRun(
      tenant.organizationId,
      runId,
    )

    // 6.4: 审计 — 只记录 id/hash/ref 摘要
    await this.audit.log({
      event: 'SOURCE_ATTRIBUTION_READ',
      userId: authUser.id,
      organizationId: tenant.organizationId,
      metadata: {
        compilerRunId: runId,
        attributionCount: attributions.length,
        attributionHashes: attributions.map((a) => a.contentHash),
      },
    })

    return response.ok({
      data: attributions.map((a) => ({
        id: a.id,
        compilerRunId: a.compilerRunId,
        stageId: a.stageId,
        entityId: a.entityId,
        fieldPath: a.fieldPath,
        generatedBy: a.generatedByKind,
        confidence: a.confidence,
        summary: a.summary,
        humanReviewStatus: a.humanReviewStatus,
        sourceRefCount: (a.sourceRefs as Array<unknown>)?.length ?? 0,
        createdAt: a.createdAt,
      })),
    })
  }

  /**
   * GET /api/v1/compiler-runs/:runId/attributions/:id —— 查询单个 attribution。
   */
  async getAttribution(ctx: HttpContext) {
    const { response, authUser, tenant, params } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewAttribution(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const id = Number(params.id)
    if (Number.isNaN(id)) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid attribution id' },
      })
    }

    const attribution = await this.attributionService.getById(tenant.organizationId, id)
    if (!attribution) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Attribution not found' },
      })
    }

    return response.ok({
      data: {
        id: attribution.id,
        compilerRunId: attribution.compilerRunId,
        draftSessionId: attribution.draftSessionId,
        stageId: attribution.stageId,
        entityId: attribution.entityId,
        fieldPath: attribution.fieldPath,
        sourceRefs: attribution.sourceRefs,
        generatedBy: {
          kind: attribution.generatedByKind,
          provider: attribution.generatedByProvider,
          model: attribution.generatedByModel,
          ruleId: attribution.ruleId,
        },
        confidence: attribution.confidence,
        assumptions: attribution.assumptions,
        summary: attribution.summary,
        evidenceSnippets: attribution.evidenceSnippets,
        humanReviewStatus: attribution.humanReviewStatus,
        humanReviewedBy: attribution.humanReviewedBy,
        createdAt: attribution.createdAt,
      },
    })
  }

  /**
   * GET /api/v1/projects/:projectId/entities/:entityType/:entityId/source-attribution —— 实体来源摘要。
   */
  async getEntitySourceAttribution(ctx: HttpContext) {
    const { response, authUser, tenant, params } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewAttribution(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const { entityId } = params
    if (!entityId || typeof entityId !== 'string') {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid entityId' },
      })
    }

    const attributions = await this.attributionService.listByEntity(tenant.organizationId, entityId)

    const entityAttr = attributions.find((a) => !a.fieldPath)
    const fieldAttributions = attributions
      .filter((a) => a.fieldPath)
      .map((a) => ({
        fieldPath: a.fieldPath!,
        generatedBy: a.generatedByKind,
        confidence: a.confidence,
        summary: a.summary,
        attributionId: a.id,
      }))

    return response.ok({
      data: {
        entityId,
        entityType: params.entityType ?? 'unknown',
        hasFieldLevel: fieldAttributions.length > 0,
        fieldAttributions,
        entityAttribution: entityAttr
          ? {
              attributionId: entityAttr.id,
              generatedBy: entityAttr.generatedByKind,
              stageId: entityAttr.stageId,
              confidence: entityAttr.confidence,
              summary: entityAttr.summary,
              humanReviewStatus: entityAttr.humanReviewStatus,
              evidenceCount: (entityAttr.evidenceSnippets as Array<unknown>)?.length ?? 0,
              sourceRefCount: (entityAttr.sourceRefs as Array<unknown>)?.length ?? 0,
            }
          : null,
      },
    })
  }

  /**
   * GET /api/v1/projects/:projectId/traceability/links —— 项目追溯链接。
   */
  async listProjectTraceabilityLinks(ctx: HttpContext) {
    const { response, authUser, tenant, params } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewTraceability(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const projectId = Number(params.projectId)
    if (Number.isNaN(projectId)) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid projectId' },
      })
    }

    const links = await this.traceabilityService.listByProject(tenant.organizationId, projectId)

    return response.ok({
      data: links.map((l) => ({
        linkId: l.id,
        relationType: l.relationType,
        direction: l.direction,
        sourceEntityType: l.sourceEntityType,
        sourceEntityId: l.sourceEntityId,
        targetEntityType: l.targetEntityType,
        targetEntityId: l.targetEntityId,
        strength: l.strength,
        attributionId: l.sourceAttributionId,
        createdAt: l.createdAt,
      })),
    })
  }
}
