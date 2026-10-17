import PhysicalContradictionPolicy from '#policies/physical_contradiction_policy'
import PhysicalContradictionAnalyzerService from '#services/triz_contradiction/physical_analyzer_service'
import {
  createPhysicalAnalysisValidator,
  listPhysicalAnalysesValidator,
  listPhysicalCandidatesValidator,
  reviewPhysicalCandidateValidator,
  explainPhysicalCandidateValidator,
} from '#validators/triz_physical_contradiction'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

@inject()
export default class PhysicalContradictionAnalyzerController {
  constructor(
    private service: PhysicalContradictionAnalyzerService,
    private policy: PhysicalContradictionPolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgProject(ctx: HttpContext): { organizationId: number; projectId: number } {
    return {
      organizationId: ctx.tenant!.organizationId,
      projectId: Number(ctx.params.projectId),
    }
  }

  async create(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    await this.policy.analyze(user, organizationId, projectId)

    const payload = await ctx.request.validateUsing(createPhysicalAnalysisValidator)
    const result = await this.service.createRun({
      organizationId,
      projectId,
      actorId: user.id,
      userContext: payload.userContext,
      idempotencyKey: payload.idempotencyKey,
    })

    return ctx.response.ok({
      data: {
        ...this.runToDTO(result.run),
        candidates: result.candidates.map((c) => this.candidateToDTO(c)),
      },
    })
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    await this.policy.analyze(user, organizationId, projectId)

    const filters = await ctx.request.validateUsing(listPhysicalAnalysesValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.service.listRuns(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    await this.policy.analyze(user, organizationId, projectId)

    const runId = Number(ctx.params.runId)
    const data = await this.service.getRun(organizationId, projectId, runId)
    return ctx.response.ok({ data })
  }

  async candidates(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    await this.policy.analyze(user, organizationId, projectId)

    const runId = Number(ctx.params.runId)
    const filters = await ctx.request.validateUsing(listPhysicalCandidatesValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.service.listCandidates(organizationId, projectId, runId, filters)
    return ctx.response.ok(result)
  }

  async explain(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    await this.policy.aiExplain(user, organizationId, projectId)

    await ctx.request.validateUsing(explainPhysicalCandidateValidator)
    const runId = Number(ctx.params.runId)
    const candidateKey = ctx.params.candidateKey
    const explanation = await this.service.explainCandidate(
      organizationId,
      projectId,
      runId,
      candidateKey,
    )
    return ctx.response.ok({
      data: { candidateKey, explanation },
    })
  }

  async review(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    const allowed = await this.policy.manage(user, organizationId, projectId)
    if (!allowed) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无权审查候选' },
      })
    }

    const payload = await ctx.request.validateUsing(reviewPhysicalCandidateValidator)
    const runId = Number(ctx.params.runId)
    const candidateKey = ctx.params.candidateKey
    const result = await this.service.reviewCandidate(
      organizationId,
      projectId,
      runId,
      candidateKey,
      user.id,
      payload.action,
    )
    return ctx.response.ok({ data: result })
  }

  async confirmationPreview(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    await this.policy.manage(user, organizationId, projectId)

    const runId = Number(ctx.params.runId)
    const candidateKey = ctx.params.candidateKey
    const preview = await this.service.confirmationPreview(
      organizationId,
      projectId,
      runId,
      candidateKey,
    )
    return ctx.response.ok({ data: preview })
  }

  async handoffPreview(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    await this.policy.manage(user, organizationId, projectId)

    const runId = Number(ctx.params.runId)
    const candidateKey = ctx.params.candidateKey
    const targetType = (ctx.request.body() as any).targetType ?? 'contradiction'
    const preview = await this.service.handoffPreview(
      organizationId,
      projectId,
      runId,
      candidateKey,
      targetType,
    )
    return ctx.response.ok({ data: preview })
  }

  private runToDTO(run: any): any {
    return {
      id: run.id,
      organizationId: run.organizationId,
      projectId: run.projectId,
      actorId: run.actorId,
      status: run.status,
      inputSignature: run.inputSignature,
      outputHash: run.outputHash,
      ruleVersion: run.ruleVersion,
      idempotencyKey: run.idempotencyKey,
      sourceSummary: run.sourceSummaryJson,
      warningSummary: run.warningSummaryJson,
      candidateCount: run.candidateCount,
      costSummary: run.costSummaryJson,
      createdAt: run.createdAt?.toISO?.() ?? run.createdAt,
      updatedAt: run.updatedAt?.toISO?.() ?? run.updatedAt,
      completedAt: run.completedAt?.toISO?.() ?? run.completedAt,
      archivedAt: run.archivedAt?.toISO?.() ?? run.archivedAt,
    }
  }

  private candidateToDTO(c: any): any {
    return {
      candidateKey: c.candidateKey,
      ruleId: c.ruleId,
      ruleVersion: c.ruleVersion,
      status: c.status,
      parameterKey: c.parameterKey,
      requirementA: c.requirementAJson,
      requirementB: c.requirementBJson,
      separationAxis: c.separationAxis,
      contextA: c.contextA,
      contextB: c.contextB,
      conditionRefs: c.conditionRefsJson,
      severity: c.severity,
      confidence: c.confidence,
      impactScore: c.impactScore,
      evidenceRefs: c.evidenceRefsJson,
      affectedScope: c.affectedScopeJson,
      principleRefs: c.principleRefsJson,
      rationaleSummary: c.rationaleSummary,
      warningCodes: c.warningCodesJson,
      sourceHashes: c.sourceHashesJson,
      outputHash: c.outputHash,
      reviewedBy: c.reviewedBy,
      reviewedAt: c.reviewedAt?.toISO?.() ?? c.reviewedAt,
      aiExplanationRef: c.aiExplanationRef,
      createdAt: c.createdAt?.toISO?.() ?? c.createdAt,
      updatedAt: c.updatedAt?.toISO?.() ?? c.updatedAt,
    }
  }
}
