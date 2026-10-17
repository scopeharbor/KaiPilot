/**
 * v3-multi-project-impact-analysis —— MultiProjectImpactAnalysisController（§6）
 *
 * Controller 只解析 HTTP 与格式化响应，业务逻辑留在 Service。
 */

import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import MultiProjectImpactAnalysisService from '#services/multi_project_impact_analysis_service'
import MultiProjectImpactAnalysisPolicy from '#policies/multi_project_impact_analysis_policy'
import type { ImpactPolicyActor } from '#policies/multi_project_impact_analysis_policy'
import RbacService from '#services/rbac_service'
import ProjectMember from '#models/project_member'
import {
  planImpactAnalysisValidator,
  runImpactAnalysisValidator,
  listImpactSnapshotsValidator,
  readImpactSnapshotValidator,
  refreshImpactSnapshotValidator,
  whatIfImpactAnalysisValidator,
  exportImpactAnalysisValidator,
  followUpImpactAnalysisValidator,
  aiExplanationImpactAnalysisValidator,
  drillDownImpactAnalysisValidator,
} from '#validators/multi_project_impact_validator'

@inject()
export default class MultiProjectImpactAnalysisController {
  constructor(
    private service: MultiProjectImpactAnalysisService,
    private policy: MultiProjectImpactAnalysisPolicy,
    private rbac: RbacService,
  ) {}

  /**
   * 组装 policy actor。
   *
   * User 模型上没有 organizationId / permissions / visibleProjectIds 这些字段：
   * 组织来自 tenant_middleware 注入的 ctx.tenant（design D8），权限由 RbacService
   * 按组织角色解析，可见项目由 project_members 得出。
   */
  private async getActor(ctx: HttpContext): Promise<ImpactPolicyActor> {
    const user = ctx.auth.user!
    const organizationId = ctx.tenant?.organizationId ?? 0

    const permissions = await this.rbac.resolveOrganizationPermissions(user, organizationId)
    const memberships = await ProjectMember.query()
      .where('user_id', user.id)
      .where('is_active', true)

    return {
      id: user.id,
      organizationId,
      permissions: [...permissions],
      visibleProjectIds: memberships.map((m) => Number(m.projectId)),
    }
  }

  private checkFeatureEnabled({ response }: HttpContext): boolean {
    if (!this.service.isFeatureEnabled()) {
      response.status(503).json({
        error: { code: 'FEATURE_DISABLED', message: '多项目影响分析功能未启用' },
      })
      return false
    }
    return true
  }

  // ─── Plan ────────────────────────────────────────────────────────

  async plan(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({ actor, organizationId: orgId, operation: 'plan' })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(planImpactAnalysisValidator)
    const plan = await this.service.planAnalysis(orgId, payload.scope, actor)
    response.status(200).json({ data: plan })
  }

  // ─── Run ─────────────────────────────────────────────────────────

  async run(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({ actor, organizationId: orgId, operation: 'run' })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(runImpactAnalysisValidator)
    try {
      const snapshot = await this.service.runAnalysis(orgId, payload.runToken, actor)
      response.status(200).json({ data: snapshot })
    } catch (e: any) {
      response.status(422).json({
        error: { code: 'STALE_PLAN', message: e.message ?? '分析计划无效或已过期' },
      })
    }
  }

  // ─── List ────────────────────────────────────────────────────────

  async list(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({ actor, organizationId: orgId, operation: 'list' })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(listImpactSnapshotsValidator)
    const result = await this.service.listSnapshots(orgId, payload)
    response.status(200).json(result)
  }

  // ─── Read ────────────────────────────────────────────────────────

  async read(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({ actor, organizationId: orgId, operation: 'read' })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(readImpactSnapshotValidator)
    try {
      const snapshot = await this.service.readSnapshot(orgId, payload.snapshotId)
      response.status(200).json({ data: snapshot })
    } catch (e: any) {
      response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: e.message ?? '快照不存在' },
      })
    }
  }

  // ─── Refresh ─────────────────────────────────────────────────────

  async refresh(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({ actor, organizationId: orgId, operation: 'refresh' })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(refreshImpactSnapshotValidator)
    try {
      const snapshot = await this.service.refreshSnapshot(orgId, payload.snapshotId, actor)
      response.status(200).json({ data: snapshot })
    } catch (e: any) {
      response.status(422).json({
        error: { code: 'ANALYSIS_FAILED', message: e.message ?? '刷新失败' },
      })
    }
  }

  // ─── What-if ─────────────────────────────────────────────────────

  async whatIf(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({ actor, organizationId: orgId, operation: 'what_if' })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(whatIfImpactAnalysisValidator)
    const outputs = await this.service.runWhatIf(
      orgId,
      payload.snapshotId,
      payload.scenarios,
      actor,
    )
    const snapshot = await this.service.readSnapshot(orgId, payload.snapshotId)
    response.status(200).json({
      data: outputs,
      meta: {
        snapshotId: payload.snapshotId,
        snapshotHash: snapshot.outputHash,
        isStale: snapshot.isStale,
        staleReason: snapshot.staleReason,
      },
    })
  }

  // ─── Export ──────────────────────────────────────────────────────

  async export(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({ actor, organizationId: orgId, operation: 'export' })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(exportImpactAnalysisValidator)
    const result = await this.service.exportSnapshot(
      orgId,
      payload.snapshotId,
      payload.format,
      actor,
    )
    response.status(200).json({ data: result })
  }

  // ─── Follow-up Draft ─────────────────────────────────────────────

  async followUp(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({ actor, organizationId: orgId, operation: 'follow_up' })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(followUpImpactAnalysisValidator)
    const draft = await this.service.buildFollowUpDraft(
      orgId,
      payload.snapshotId,
      payload.affectedEndpointHashes,
      payload.targetCapability,
      actor,
    )
    response.status(200).json({ data: draft })
  }

  // ─── AI Explanation ──────────────────────────────────────────────

  async aiExplanation(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({
      actor,
      organizationId: orgId,
      operation: 'ai_explanation',
    })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(aiExplanationImpactAnalysisValidator)
    const explanation = await this.service.getAiExplanation(
      orgId,
      payload.snapshotId,
      actor,
      payload.focus,
    )
    response.status(200).json({ data: explanation })
  }

  // ─── Drill-down ──────────────────────────────────────────────────

  async drillDown(ctx: HttpContext) {
    const { request, response, params } = ctx
    if (!this.checkFeatureEnabled(ctx)) return
    const actor = await this.getActor(ctx)
    const orgId = Number(params.organizationId)

    const authz = this.policy.authorize({ actor, organizationId: orgId, operation: 'drill_down' })
    if (!authz.authorized) {
      response.status(403).json({ error: { code: 'PERMISSION_DENIED', message: authz.reason } })
      return
    }

    const payload = await request.validateUsing(drillDownImpactAnalysisValidator)
    const snapshot = await this.service.readSnapshot(orgId, payload.snapshotId)

    // 查找匹配的端点
    for (const path of snapshot.propagationSummary.propagationPaths) {
      for (const ep of path.affectedEndpoints) {
        if (ep.evidenceHash === payload.endpointHash && ep.visibility === 'visible') {
          const authorized = this.policy.canDrillDownToEndpoint(
            actor,
            ep.endpointType,
            ep.projectId,
          )
          response.status(200).json({
            data: { ...ep, fullPath: path, authorizationVerified: authorized },
          })
          return
        }
      }
    }

    response.status(404).json({
      error: { code: 'RESOURCE_NOT_FOUND', message: '端点不存在或无权访问' },
    })
  }
}
