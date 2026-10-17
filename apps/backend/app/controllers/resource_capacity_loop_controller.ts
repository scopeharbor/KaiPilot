// v3-resource-capacity-forecasting-closed-loop §7 —— Controller。
// 职责严格限定：feature flag → 认证 → 参数校验 → Policy → Service → 响应格式化。零业务逻辑。
import { inject } from '@adonisjs/core'
import { FeatureDisabledException } from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'
import ResourceCapacityLoopPolicy from '#policies/resource_capacity_loop_policy'
import ResourceCapacityWorkbenchService from '#services/resource_capacity_loop/workbench_service'
import {
  resourceCapacityLoopParamsValidator,
  resourceCapacityLoopListQueryValidator,
  resourceCapacityLoopCreateValidator,
  resourceCapacityScenarioBodyValidator,
  resourceCapacitySimulateValidator,
  resourceCapacitySelectValidator,
  resourceCapacityHandoffValidator,
  resourceCapacityObservationValidator,
  resourceCapacityReviewValidator,
  resourceCapacityCloseValidator,
  resourceCapacityCancelValidator,
} from '#validators/resource_capacity_loop'

@inject()
export default class ResourceCapacityLoopController {
  constructor(
    private readonly workbench: ResourceCapacityWorkbenchService,
    private readonly policy: ResourceCapacityLoopPolicy,
  ) {}

  private async guard(ctx: HttpContext, mode: 'view' | 'manage') {
    const user = ctx.auth.getUserOrFail()
    if (!this.workbench.isFeatureEnabled()) {
      throw new FeatureDisabledException('资源容量闭环功能已关闭')
    }
    const params = await resourceCapacityLoopParamsValidator.validate({
      organizationId: Number(ctx.params.organizationId),
      loopId: ctx.params.loopId ? Number(ctx.params.loopId) : undefined,
      receiptId: ctx.params.receiptId ? Number(ctx.params.receiptId) : undefined,
    })
    await this.policy.assertOrganizationVisible(user, params.organizationId)
    if (mode === 'view') await this.policy.authorizeView(user, params.organizationId)
    else await this.policy.authorizeManage(user, params.organizationId)
    return {
      user,
      organizationId: params.organizationId,
      loopId: params.loopId,
      receiptId: params.receiptId,
    }
  }

  /** GET / — loop 队列列表（只读摘要，不加载 snapshot body）。 */
  async index(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'view')
    const query = await resourceCapacityLoopListQueryValidator.validate(ctx.request.qs())
    return ctx.response.ok(await this.workbench.list(g.organizationId, query))
  }

  /** POST / — 创建 loop。 */
  async store(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const body = await resourceCapacityLoopCreateValidator.validate(ctx.request.body())
    const loop = await this.workbench.create({
      organizationId: g.organizationId,
      actorUserId: g.user.id,
      ...body,
    })
    return ctx.response.created({
      data: { id: loop.id, state: loop.state, revision: loop.rowVersion },
    })
  }

  /** GET /:loopId — 详情工作台 header。 */
  async show(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'view')
    const detail = await this.workbench.detail(g.organizationId, g.loopId!)
    if (!detail)
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'loop 不存在' },
      })
    return ctx.response.ok({ data: detail })
  }

  /** POST /:loopId/baseline-refresh — 基线刷新（当前显式降级语义）。 */
  async refreshBaseline(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const result = await this.workbench.refreshBaseline(g.organizationId, g.loopId!, g.user.id)
    return ctx.response.accepted({ data: result })
  }

  /** POST /:loopId/scenarios — 创建情景。 */
  async storeScenario(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const body = await resourceCapacityScenarioBodyValidator.validate(ctx.request.body())
    const r = await this.workbench.scenarios.createScenario({
      organizationId: g.organizationId,
      loopId: g.loopId!,
      actorUserId: g.user.id,
      name: body.name,
      overlays: body.overlays,
      expectedLoopRevision: body.expectedRevision,
      authz: {
        visibleProjectIds: [],
        authorizedPreviewRefIds: [],
        knownRequirementRefIds: [],
        knownRoleKeys: body.overlays.flatMap((o) =>
          o.kind === 'capacity-delta' && typeof (o as { role?: unknown }).role === 'string'
            ? [(o as unknown as { role: string }).role]
            : [],
        ),
        knownSkillKeys: body.overlays.flatMap((o) =>
          o.kind === 'capacity-delta' &&
          typeof (o as { normalizedSkillKey?: unknown }).normalizedSkillKey === 'string'
            ? [(o as unknown as { normalizedSkillKey: string }).normalizedSkillKey]
            : [],
        ),
      },
    })
    if (!r.ok) {
      return ctx.response.unprocessableEntity({
        error: { code: r.reasonCode, message: r.detail ?? '校验失败' },
      })
    }
    return ctx.response.created({ data: { id: r.value.id, revision: r.value.rowVersion } })
  }

  /** POST /:loopId/simulate — 模拟全部情景。 */
  async simulate(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const body = await resourceCapacitySimulateValidator.validate(ctx.request.body())
    const r = await this.workbench.simulation.simulateAll({
      organizationId: g.organizationId,
      loopId: g.loopId!,
      expectedLoopRevision: body.expectedRevision,
    })
    if (!r.ok) {
      return ctx.response.conflict({
        error: { code: r.reasonCode ?? 'RCCL_REVISION_CONFLICT', message: r.detail ?? '模拟失败' },
      })
    }
    return ctx.response.ok({
      data: {
        loopState: r.loopState,
        loopRevision: r.loopRowVersion,
        results: r.results.map((x) => ({
          scenarioId: x.scenarioId,
          simulationSnapshotId: x.simulationSnapshotId,
          gapDeltaHours: x.gapDeltaHours,
          idempotentReuse: !x.created,
        })),
      },
    })
  }

  /** POST /:loopId/select — 人工选择。 */
  async select(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const body = await resourceCapacitySelectValidator.validate(ctx.request.body())
    const r = await this.workbench.selection.select({
      organizationId: g.organizationId,
      loopId: g.loopId!,
      actorType: body.actorType ?? 'human_user',
      actorUserId: g.user.id,
      scenarioId: body.scenarioId,
      simulationSnapshotId: body.simulationSnapshotId,
      acknowledgedWarnings: body.acknowledgedWarnings ?? [],
      currentPermissionFingerprint: body.currentPermissionFingerprint,
    })
    if (!r.ok) {
      return ctx.response.conflict({
        error: { code: r.reasonCode, message: r.detail ?? '选择失败' },
      })
    }
    return ctx.response.ok({
      data: {
        selectionId: r.value.selection.id,
        fingerprint: r.value.selection.selectionFingerprint,
        expiresAt: r.value.expiresAt.toISO(),
        replayed: r.value.replayed,
        writesApplied: false,
        confirmationRequired: true,
      },
    })
  }

  /** POST /:loopId/handoff — 受控 handoff。 */
  async handoff(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const body = await resourceCapacityHandoffValidator.validate(ctx.request.body())
    const r = await this.workbench.handoff.createHandoff({
      organizationId: g.organizationId,
      loopId: g.loopId!,
      actorType: body.actorType ?? 'human_user',
      actorUserId: g.user.id,
      target: body.target,
      idempotencyKey: body.idempotencyKey,
      requestedRefs: body.requestedRefs,
      authorizedVisibleRefIds: body.authorizedVisibleRefIds,
    })
    if (!r.ok) {
      return ctx.response.conflict({
        error: { code: r.reasonCode, message: r.detail ?? 'handoff 失败' },
      })
    }
    return ctx.response.ok({
      data: {
        receiptId: r.value.receipt.id,
        status: r.value.receipt.status,
        pendingRefId: r.value.receipt.pendingRefId,
        replayed: r.value.replayed,
        writesApplied: false,
        confirmationRequired: true,
      },
    })
  }

  /** GET /:loopId/handoffs/:receiptId/status — 只读状态投影。 */
  async handoffStatus(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'view')
    const status = await this.workbench.observation.getHandoffStatus(g.organizationId, g.receiptId!)
    if (!status)
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'receipt 不存在' },
      })
    return ctx.response.ok({ data: status })
  }

  /** POST /:loopId/observations — 捕获观察快照。 */
  async captureObservation(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const body = await resourceCapacityObservationValidator.validate(ctx.request.body())
    const r = await this.workbench.observation.capture({
      organizationId: g.organizationId,
      loopId: g.loopId!,
      downstreamStatus: body.downstreamStatus,
      appliedItemRefs: body.appliedItemRefs,
      failedItemRefs: body.failedItemRefs,
      unrelatedChangeNotes: body.unrelatedChangeNotes,
    })
    if (!r.ok) {
      return ctx.response.conflict({
        error: { code: r.reasonCode, message: r.detail ?? '观察失败' },
      })
    }
    return ctx.response.created({
      data: {
        observationId: r.observation.id,
        comparable: r.comparison.comparability.comparable,
        reasonCodes: r.comparison.comparability.reasonCodes,
        totalForecastErrorHours: r.comparison.totalForecastErrorHours,
      },
    })
  }

  /** POST /:loopId/review — 人工复核。 */
  async review(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const body = await resourceCapacityReviewValidator.validate(ctx.request.body())
    const r = await this.workbench.review.review({
      organizationId: g.organizationId,
      loopId: g.loopId!,
      actorType: body.actorType ?? 'human_user',
      observationSnapshotId: body.observationSnapshotId,
      outcome: body.outcome,
      boundedRationale: body.boundedRationale,
      acknowledgedWarnings: body.acknowledgedWarnings ?? [],
      expectedObservationCreatedAt: '',
    })
    if (!r.ok) {
      return ctx.response.conflict({
        error: { code: r.reasonCode, message: r.detail ?? '复核失败' },
      })
    }
    return ctx.response.ok({ data: { reviewId: r.value.id, outcome: r.value.outcome } })
  }

  /** POST /:loopId/close — 关单。 */
  async close(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const body = await resourceCapacityCloseValidator.validate(ctx.request.body())
    const r = await this.workbench.review.close({
      organizationId: g.organizationId,
      loopId: g.loopId!,
      actorType: body.actorType ?? 'human_user',
      expectedLoopRevision: body.expectedRevision,
    })
    if (!r.ok) {
      return ctx.response.conflict({
        error: { code: r.reasonCode, message: r.detail ?? '关闭失败' },
      })
    }
    return ctx.response.ok({ data: { state: r.value.state, revision: r.value.rowVersion } })
  }

  /** POST /:loopId/cancel — 取消。 */
  async cancel(ctx: HttpContext) {
    const g = await this.guard(ctx as never, 'manage')
    const body = await resourceCapacityCancelValidator.validate(ctx.request.body())
    const r = await this.workbench.review.cancel({
      organizationId: g.organizationId,
      loopId: g.loopId!,
      actorType: body.actorType ?? 'human_user',
      reason: body.reason ?? '',
    })
    if (!r.ok) {
      return ctx.response.conflict({
        error: { code: r.reasonCode, message: r.detail ?? '取消失败' },
      })
    }
    return ctx.response.ok({ data: { state: r.value.state, revision: r.value.rowVersion } })
  }
}
