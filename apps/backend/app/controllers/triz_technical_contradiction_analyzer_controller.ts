import type { HttpContext } from '@adonisjs/core/http'
import TechnicalContradictionAnalyzerService from '#services/triz_contradiction/technical_contradiction_analyzer_service'
import TechnicalContradictionPolicy from '#policies/technical_contradiction_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import { inject } from '@adonisjs/core'
import {
  createTechnicalAnalysisValidator,
  listTechnicalAnalysesValidator,
  listTechnicalCandidatesValidator,
  reviewTechnicalCandidateValidator,
  explainTechnicalCandidateValidator,
} from '#validators/triz_technical_contradiction'

/**
 * 技术矛盾分析器控制器（v3-triz-technical-contradiction-analyzer §5.7）。
 *
 * 提供 /api/v1/projects/:projectId/triz/technical-contradiction-analyses 端点：
 * - create / list / detail runs
 * - list candidates
 * - AI explain / review / confirmation preview / handoff preview
 */
@inject()
export default class TechnicalContradictionAnalyzerController {
  constructor(
    private service: TechnicalContradictionAnalyzerService,
    private policy: TechnicalContradictionPolicy,
    private audit: AuditService,
  ) {}

  /** POST /projects/:projectId/triz/technical-contradiction-analyses */
  async create({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const orgId = tenant!.organizationId

    const canAnalyze = await this.policy.analyze(user, orgId, projectId)
    if (!canAnalyze) {
      await this.audit.log({
        event: AuditEvent.TECHNICAL_CONTRADICTION_PERMISSION_DENIED,
        userId: user.id,
        organizationId: orgId,
        projectId,
      })
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权执行技术矛盾分析' },
      })
    }

    const payload = await request.validateUsing(createTechnicalAnalysisValidator)
    const result = await this.service.createAnalysis(orgId, projectId, user.id, payload)
    return response.json({ data: result })
  }

  /** GET /projects/:projectId/triz/technical-contradiction-analyses */
  async index({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const orgId = tenant!.organizationId

    const canAnalyze = await this.policy.analyze(user, orgId, projectId)
    if (!canAnalyze) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看技术矛盾分析' },
      })
    }

    const query = await request.validateUsing(listTechnicalAnalysesValidator)
    const result = await this.service.listRuns(orgId, projectId, query)
    return response.json(result)
  }

  /** GET /projects/:projectId/triz/technical-contradiction-analyses/:runId */
  async show({ params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const orgId = tenant!.organizationId

    const canAnalyze = await this.policy.analyze(user, orgId, projectId)
    if (!canAnalyze) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看技术矛盾分析' },
      })
    }

    const result = await this.service.getRun(orgId, projectId, runId)
    return response.json({ data: result })
  }

  /** GET /projects/:projectId/triz/technical-contradiction-analyses/:runId/candidates */
  async candidates({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const orgId = tenant!.organizationId

    const canAnalyze = await this.policy.analyze(user, orgId, projectId)
    if (!canAnalyze) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看技术矛盾候选' },
      })
    }

    const query = await request.validateUsing(listTechnicalCandidatesValidator)
    const result = await this.service.listCandidates(orgId, projectId, runId, query)
    return response.json(result)
  }

  /** POST /projects/:projectId/triz/technical-contradiction-analyses/:runId/candidates/:candidateId/explain */
  async explain({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const candidateKey = params.candidateId
    const orgId = tenant!.organizationId

    await request.validateUsing(explainTechnicalCandidateValidator)

    const canExplain = await this.policy.aiExplain(user, orgId, projectId)
    if (!canExplain) {
      await this.audit.log({
        event: AuditEvent.TECHNICAL_CONTRADICTION_PERMISSION_DENIED,
        userId: user.id,
        organizationId: orgId,
        projectId,
      })
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权请求 AI 解释' },
      })
    }

    // AI explanation: in this deterministic-first implementation,
    // we return a fallback rationale (no real model call).
    const candidatesResult = await this.service.listCandidates(orgId, projectId, runId, {})
    const targetCandidate = candidatesResult.data.find((c) => c.candidateKey === candidateKey)

    if (!targetCandidate) {
      return response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '候选不存在' },
      })
    }

    await this.audit.log({
      event: AuditEvent.TECHNICAL_CONTRADICTION_AI_EXPLANATION_FALLBACK,
      userId: user.id,
      organizationId: orgId,
      projectId,
      metadata: { runId, candidateKey },
    })

    return response.json({
      data: {
        candidateKey,
        explanation: {
          narrative: targetCandidate.rationaleSummary || '（AI 解释暂不可用）',
          isFallback: true,
          hallucinationChecked: true,
          degradedReason: 'AI 解释默认使用确定性降级路径',
          referencedPrincipleIds: targetCandidate.principleRefs.map((p) => p.principleId),
          referencedParameterKeys: [
            targetCandidate.improvingParameterKey,
            targetCandidate.worseningParameterKey,
          ],
          confidence: targetCandidate.confidence,
          provider: null,
          model: null,
          cost: null,
        },
      },
    })
  }

  /** POST /projects/:projectId/triz/technical-contradiction-analyses/:runId/candidates/:candidateId/review */
  async review({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const candidateKey = params.candidateId
    const orgId = tenant!.organizationId

    const canManage = await this.policy.manage(user, orgId, projectId)
    if (!canManage) {
      await this.audit.log({
        event: AuditEvent.TECHNICAL_CONTRADICTION_PERMISSION_DENIED,
        userId: user.id,
        organizationId: orgId,
        projectId,
      })
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权审查技术矛盾候选' },
      })
    }

    const payload = await request.validateUsing(reviewTechnicalCandidateValidator)
    const result = await this.service.reviewCandidate(
      orgId,
      projectId,
      runId,
      candidateKey,
      user.id,
      payload,
    )
    return response.json({ data: result })
  }

  /** POST /projects/:projectId/triz/technical-contradiction-analyses/:runId/candidates/:candidateId/confirmation-preview */
  async confirmationPreview({ params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const candidateKey = params.candidateId
    const orgId = tenant!.organizationId

    const canManage = await this.policy.manage(user, orgId, projectId)
    if (!canManage) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看确认预览' },
      })
    }

    const result = await this.service.createConfirmationPreview(
      orgId,
      projectId,
      runId,
      candidateKey,
    )
    return response.json({ data: result })
  }

  /** POST /projects/:projectId/triz/technical-contradiction-analyses/:runId/candidates/:candidateId/handoff-preview */
  async handoffPreview({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const candidateKey = params.candidateId
    const orgId = tenant!.organizationId

    const canManage = await this.policy.manage(user, orgId, projectId)
    if (!canManage) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看交接预览' },
      })
    }

    const { targetType } = request.qs() as { targetType?: string }
    const validTypes = ['contradiction', 'decision_log', 'workbench', 'draft_layer'] as const
    const tt = validTypes.includes(targetType as any)
      ? (targetType as (typeof validTypes)[number])
      : 'decision_log'

    const result = await this.service.createHandoffPreview(
      orgId,
      projectId,
      runId,
      candidateKey,
      tt,
      user.id,
    )
    return response.json({ data: result })
  }
}
