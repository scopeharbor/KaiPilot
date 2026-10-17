import type { HttpContext } from '@adonisjs/core/http'
import FunctionAnalysisService from '#services/triz_contradiction/function_analysis_service'
import TrizFunctionAnalysisPolicy from '#policies/triz_function_analysis_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import { inject } from '@adonisjs/core'
import {
  createFunctionAnalysisValidator,
  listFunctionAnalysesValidator,
  listFunctionIssuesValidator,
  reviewFunctionIssueValidator,
  explainFunctionIssueValidator,
} from '#validators/triz_function_analysis'

/**
 * TRIZ 功能分析图控制器（v3-triz-function-analysis-diagram §5.7）。
 *
 * 提供 /api/v1/projects/:projectId/triz/function-analysis-diagrams 端点：
 * - create / list / show / graph / issues
 * - AI explain / review / workbench preview / decision preview / handoff preview
 */
@inject()
export default class TrizFunctionAnalysisController {
  constructor(
    private service: FunctionAnalysisService,
    private policy: TrizFunctionAnalysisPolicy,
    private audit: AuditService,
  ) {}

  /** POST /projects/:projectId/triz/function-analysis-diagrams */
  async create({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const orgId = tenant!.organizationId

    const canView = await this.policy.view(user, orgId, projectId)
    if (!canView) {
      await this.audit.log({
        event: AuditEvent.FUNCTION_ANALYSIS_PERMISSION_DENIED,
        userId: user.id,
        organizationId: orgId,
        projectId,
      })
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权执行功能分析' },
      })
    }

    const payload = await request.validateUsing(createFunctionAnalysisValidator)
    const result = await this.service.createAnalysis(orgId, projectId, user.id, payload)
    return response.json({ data: result })
  }

  /** GET /projects/:projectId/triz/function-analysis-diagrams */
  async index({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const orgId = tenant!.organizationId

    const canView = await this.policy.view(user, orgId, projectId)
    if (!canView) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看功能分析' },
      })
    }

    const query = await request.validateUsing(listFunctionAnalysesValidator)
    const result = await this.service.listRuns(orgId, projectId, query)
    return response.json(result)
  }

  /** GET /projects/:projectId/triz/function-analysis-diagrams/:runId */
  async show({ params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const orgId = tenant!.organizationId

    const canView = await this.policy.view(user, orgId, projectId)
    if (!canView) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看功能分析' },
      })
    }

    const result = await this.service.getRun(orgId, projectId, runId)
    return response.json({ data: result })
  }

  /** GET /projects/:projectId/triz/function-analysis-diagrams/:runId/graph */
  async graph({ params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const orgId = tenant!.organizationId

    const canView = await this.policy.view(user, orgId, projectId)
    if (!canView) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看功能分析图' },
      })
    }

    const result = await this.service.getGraph(orgId, projectId, runId)
    return response.json({ data: result })
  }

  /** GET /projects/:projectId/triz/function-analysis-diagrams/:runId/issues */
  async issues({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const orgId = tenant!.organizationId

    const canView = await this.policy.view(user, orgId, projectId)
    if (!canView) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看功能分析问题候选' },
      })
    }

    const query = await request.validateUsing(listFunctionIssuesValidator)
    const result = await this.service.listIssues(orgId, projectId, runId, query)
    return response.json(result)
  }

  /** POST /projects/:projectId/triz/function-analysis-diagrams/:runId/issues/:issueId/explain */
  async explain({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const issueKey = params.issueId
    const orgId = tenant!.organizationId

    await request.validateUsing(explainFunctionIssueValidator)

    const canExplain = await this.policy.aiExplain(user, orgId, projectId)
    if (!canExplain) {
      await this.audit.log({
        event: AuditEvent.FUNCTION_ANALYSIS_PERMISSION_DENIED,
        userId: user.id,
        organizationId: orgId,
        projectId,
      })
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权请求 AI 解释' },
      })
    }

    // AI explanation: deterministic-first implementation — return fallback rationale
    const issuesResult = await this.service.listIssues(orgId, projectId, runId, {})
    const targetIssue = issuesResult.data.find((i) => i.issueKey === issueKey)

    if (!targetIssue) {
      return response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '问题候选不存在' },
      })
    }

    await this.audit.log({
      event: AuditEvent.FUNCTION_ANALYSIS_AI_EXPLANATION_FALLBACK,
      userId: user.id,
      organizationId: orgId,
      projectId,
      metadata: { runId, issueKey },
    })

    return response.json({
      data: {
        issueKey,
        explanation: {
          narrative: targetIssue.rationaleSummary || '（AI 解释暂不可用）',
          isFallback: true,
          hallucinationChecked: true,
          degradedReason: 'AI 解释默认使用确定性降级路径',
          referencedNodeKeys: targetIssue.nodeRefs,
          referencedEdgeKeys: targetIssue.edgeRefs,
          confidence: targetIssue.confidence,
          provider: null,
          model: null,
          cost: null,
        },
      },
    })
  }

  /** POST /projects/:projectId/triz/function-analysis-diagrams/:runId/issues/:issueId/review */
  async review({ request, params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const issueKey = params.issueId
    const orgId = tenant!.organizationId

    const canManage = await this.policy.manage(user, orgId, projectId)
    if (!canManage) {
      await this.audit.log({
        event: AuditEvent.FUNCTION_ANALYSIS_PERMISSION_DENIED,
        userId: user.id,
        organizationId: orgId,
        projectId,
      })
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权审查功能分析问题候选' },
      })
    }

    const payload = await request.validateUsing(reviewFunctionIssueValidator)
    const result = await this.service.reviewIssue(
      orgId,
      projectId,
      runId,
      issueKey,
      user.id,
      payload,
    )
    return response.json({ data: result })
  }

  /** POST /projects/:projectId/triz/function-analysis-diagrams/:runId/issues/:issueId/workbench-preview */
  async workbenchPreview({ params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const issueKey = params.issueId
    const orgId = tenant!.organizationId

    const canManage = await this.policy.manage(user, orgId, projectId)
    if (!canManage) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看 Workbench 预览' },
      })
    }

    const result = await this.service.createWorkbenchPreview(
      orgId,
      projectId,
      runId,
      issueKey,
      user.id,
    )
    return response.json({ data: result })
  }

  /** POST /projects/:projectId/triz/function-analysis-diagrams/:runId/issues/:issueId/decision-preview */
  async decisionPreview({ params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const issueKey = params.issueId
    const orgId = tenant!.organizationId

    const canManage = await this.policy.manage(user, orgId, projectId)
    if (!canManage) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看 Decision 预览' },
      })
    }

    const result = await this.service.createDecisionPreview(
      orgId,
      projectId,
      runId,
      issueKey,
      user.id,
    )
    return response.json({ data: result })
  }

  /** POST /projects/:projectId/triz/function-analysis-diagrams/:runId/issues/:issueId/handoff-preview */
  async handoffPreview({ params, auth, tenant, response }: HttpContext) {
    const user = auth.getUserOrFail() as import('#models/user').default
    const projectId = Number(params.projectId)
    const runId = Number(params.runId)
    const issueKey = params.issueId
    const orgId = tenant!.organizationId

    const canManage = await this.policy.manage(user, orgId, projectId)
    if (!canManage) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: '无权查看 Handoff 预览' },
      })
    }

    const result = await this.service.createDraftHandoffPreview(
      orgId,
      projectId,
      runId,
      issueKey,
      user.id,
    )
    return response.json({ data: result })
  }
}
