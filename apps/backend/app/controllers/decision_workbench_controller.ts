import { inject } from '@adonisjs/core'
import { FeatureDisabledException } from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import DecisionWorkbenchPolicy from '#policies/decision_workbench_policy'
import DecisionCaseService, {
  DecisionOptionService,
  DecisionPositionService,
} from '#services/decision_workbench/decision_case_service'
import DecisionReviewService from '#services/decision_workbench/decision_review_service'
import DecisionOutcomeService from '#services/decision_workbench/decision_outcome_service'
import DecisionHandoffService, {
  listRegisteredTargets,
} from '#services/decision_workbench/decision_handoff_service'
import PluginLensHostService from '#services/decision_workbench/plugin_lens_host_service'
import DecisionAiNarrativeService from '#services/decision_workbench/ai_narrative_service'
import { isDecisionWorkbenchEnabled } from '#services/decision_workbench/decision_workbench_feature_flag'
import {
  decisionCaseListQueryValidator,
  decisionCreateValidator,
  decisionHandoffCreateValidator,
  decisionOptionCreateValidator,
  decisionOptionDeactivateValidator,
  decisionOutcomeValidator,
  decisionPositionValidator,
  decisionTransitionValidator,
  decisionUpdateValidator,
  decisionWorkbenchParamsValidator,
} from '#validators/decision_workbench'

/**
 * v3-pmo-decision-intelligence-workbench —— 薄 Controller（task 9.2）。
 *
 * 职责严格限定：认证 → 参数解析与校验 → Policy（non-leaking 404 → action →
 * source dimension）→ Service → `{data}` / `{data,meta}` / error envelope。
 * 不写业务逻辑；不直接触碰 Model。
 */
@inject()
export default class DecisionWorkbenchController {
  constructor(
    private readonly policy: DecisionWorkbenchPolicy,
    private readonly cases: DecisionCaseService,
    private readonly options: DecisionOptionService,
    private readonly positions: DecisionPositionService,
    private readonly review: DecisionReviewService,
    private readonly outcomes: DecisionOutcomeService,
    private readonly handoffs: DecisionHandoffService,
    private readonly lensHost: PluginLensHostService,
    private readonly narratives: DecisionAiNarrativeService,
  ) {}

  private assertFeature(): void {
    if (!isDecisionWorkbenchEnabled()) {
      throw new FeatureDisabledException('PMO 决策工作台功能已关闭')
    }
  }

  private async resolveOrg(ctx: HttpContext, user: User): Promise<number> {
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    return params.organizationId
  }

  // ── Cases ────────────────────────────────────────────────────────────────────

  async index(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrg(ctx, user)
    await this.policy.authorizeView(user, organizationId)
    const query = await decisionCaseListQueryValidator.validate(ctx.request.qs())
    const result = await this.cases.list(organizationId, query as Record<string, unknown>)
    return ctx.response.ok(result)
  }

  async store(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrg(ctx, user)
    await this.policy.authorizeManage(user, organizationId)
    const payload = await decisionCreateValidator.validate(ctx.request.body())
    const data = await this.cases.create(user, organizationId, {
      ...payload,
      dueDate: payload.dueDate ? payload.dueDate.toISO() : null,
    })
    return ctx.response.created({ data })
  }

  async show(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeView(user, params.organizationId)
    const data = await this.policy.assertFound(
      await this.cases.detail(params.organizationId, params.decisionId!),
    )
    return ctx.response.ok({ data })
  }

  async update(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeManage(user, params.organizationId)
    const payload = await decisionUpdateValidator.validate(ctx.request.body())
    const data = await this.cases.update(user, params.organizationId, params.decisionId!, {
      ...payload,
      dueDate:
        payload.dueDate === undefined
          ? undefined
          : payload.dueDate === null
            ? null
            : payload.dueDate.toISO(),
    })
    return ctx.response.ok({ data })
  }

  async transition(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeManage(user, params.organizationId)
    const payload = await decisionTransitionValidator.validate(ctx.request.body())
    const data = await this.cases.transition(
      user,
      params.organizationId,
      params.decisionId!,
      payload.to,
      payload.expectedRevision,
    )
    return ctx.response.ok({ data })
  }

  // ── Options ─────────────────────────────────────────────────────────────────

  async listOptions(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeView(user, params.organizationId)
    const data = await this.options.listOptions(params.organizationId, params.decisionId!)
    return ctx.response.ok({ data })
  }

  async createOption(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeManage(user, params.organizationId)
    const payload = await decisionOptionCreateValidator.validate(ctx.request.body())
    const data = await this.options.createOption(user, params.organizationId, params.decisionId!, {
      label: payload.label,
      assumptions: payload.assumptions,
      constraints: payload.constraints,
      affectedProjectRefs: payload.affectedProjectRefs,
      proposedOutcomeCategory: payload.proposedOutcomeCategory,
      evidenceRefs: payload.evidenceRefs,
    })
    return ctx.response.created({ data })
  }

  async deactivateOption(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeManage(user, params.organizationId)
    const payload = await decisionOptionDeactivateValidator.validate(ctx.request.body())
    await this.options.deactivateOption(
      user,
      params.organizationId,
      params.decisionId!,
      payload.optionId,
      payload.expectedRevision,
    )
    return ctx.response.ok({ data: { deactivated: true } })
  }

  // ── Positions ───────────────────────────────────────────────────────────────

  async listPositions(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeView(user, params.organizationId)
    const data = await this.positions.listPositions(params.organizationId, params.decisionId!)
    return ctx.response.ok({ data })
  }

  async recordPosition(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizePosition(user, params.organizationId)
    const payload = await decisionPositionValidator.validate(ctx.request.body())
    const data = await this.positions.recordPosition(
      user,
      params.organizationId,
      params.decisionId!,
      payload,
    )
    return ctx.response.ok({ data })
  }

  // ── Evidence ────────────────────────────────────────────────────────────────

  async refreshEvidence(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeManage(user, params.organizationId)
    const data = await this.review.refreshSnapshot(user, params.organizationId, params.decisionId!)
    return ctx.response.ok({ data })
  }

  async listSnapshots(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeView(user, params.organizationId)
    const data = await this.review.listSnapshots(params.organizationId, params.decisionId!)
    return ctx.response.ok({ data })
  }

  // ── Comparison / Readiness ──────────────────────────────────────────────────

  async compare(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeView(user, params.organizationId)
    const data = await this.review.compare({
      user,
      organizationId: params.organizationId,
      caseId: params.decisionId!,
    })
    return ctx.response.ok({ data })
  }

  async readiness(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeView(user, params.organizationId)
    const body = ctx.request.body() as { acknowledgedWarnings?: string[] }
    const data = await this.review.checkReadiness({
      user,
      organizationId: params.organizationId,
      caseId: params.decisionId!,
      acknowledgedWarnings: Array.isArray(body.acknowledgedWarnings)
        ? body.acknowledgedWarnings
        : [],
    })
    return ctx.response.ok({ data })
  }

  // ── Outcomes ────────────────────────────────────────────────────────────────

  async submitOutcome(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    const payload = await decisionOutcomeValidator.validate(ctx.request.body())
    const data = await this.outcomes.record(user, params.organizationId, {
      ...payload,
      caseId: params.decisionId!,
    } as never)
    return ctx.response.ok({ data })
  }

  async listOutcomes(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeView(user, params.organizationId)
    const data = await this.outcomes.listOutcomes(params.organizationId, params.decisionId!)
    return ctx.response.ok({ data })
  }

  // ── Handoffs ────────────────────────────────────────────────────────────────

  async createHandoff(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    const payload = await decisionHandoffCreateValidator.validate(ctx.request.body())
    const data = await this.handoffs.create(user, params.organizationId, {
      caseId: params.decisionId!,
      target: payload.target,
      idempotencyKey: payload.idempotencyKey,
    })
    return ctx.response.ok({ data })
  }

  async listHandoffs(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeView(user, params.organizationId)
    const data = await this.handoffs.listReceipts(params.organizationId, params.decisionId!)
    return ctx.response.ok({ data })
  }

  /** 闭集 target 目录（供前端渲染合法目标）。 */
  targets() {
    return { data: listRegisteredTargets().map((target) => ({ target })) }
  }

  // ── Advisory lenses（task 10.8：显式触发；输出仅为非信任草稿评注）────────────

  /** 从最新快照提取允许引用的低敏事实键（反幻觉白名单）。 */
  private async advisoryPacketInputs(organizationId: number, decisionId: number) {
    const snapshot = await this.review.latestSnapshotOrNull(organizationId, decisionId)
    const payloadSources = ((
      snapshot?.payload as
        { sources?: Array<{ source: string; facts: Array<{ key: string }> }> } | undefined
    )?.sources ?? []) as Array<{ source: string; facts: Array<{ key: string }> }>
    const allowedFactKeys = [
      ...new Set(payloadSources.flatMap((entry) => entry.facts.map((fact) => fact.key))),
    ]
    const options = await this.options.listOptions(organizationId, decisionId)
    return {
      snapshotHash: snapshot?.snapshotHash ?? '',
      allowedFactKeys,
      optionLabels: options.map((option) => option.label),
    }
  }

  async aiNarrative(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeRequestAi(user, params.organizationId)
    const inputs = await this.advisoryPacketInputs(params.organizationId, params.decisionId!)
    const data = await this.narratives.narrate(user, {
      organizationId: params.organizationId,
      caseId: params.decisionId!,
      comparisonDigest: inputs.snapshotHash,
      allowedFactKeys: inputs.allowedFactKeys,
    })
    return ctx.response.ok({ data })
  }

  async pluginLens(ctx: HttpContext) {
    this.assertFeature()
    const user = ctx.auth.getUserOrFail() as User
    const params = await decisionWorkbenchParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      decisionId: ctx.params.decisionId,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    await this.policy.authorizeRequestAi(user, params.organizationId)
    const body = ctx.request.body() as { pluginId?: string; lensId?: string }
    if (!body.pluginId || !body.lensId) {
      return ctx.response.status(422).send({
        error: { code: 'VALIDATION_ERROR', message: 'pluginId 与 lensId 必填' },
      })
    }
    const inputs = await this.advisoryPacketInputs(params.organizationId, params.decisionId!)
    void inputs
    const options = await this.options.listOptions(params.organizationId, params.decisionId!)
    const data = await this.lensHost.execute({
      user,
      organizationId: params.organizationId,
      lensId: String(body.lensId),
      pluginId: String(body.pluginId),
      packet: {
        caseId: params.decisionId!,
        facts: [],
        optionLabels: options.map((option) => option.label),
      },
    })
    return ctx.response.ok({ data })
  }
}
