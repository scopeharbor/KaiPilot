// v3-resource-capacity-forecasting-closed-loop §7 —— Workbench 门面服务。
// 编排 loop catalogue/list/create/detail/baseline refresh 与情景/模拟/选择/handoff/
// observation/review 调用；Controller 只做 HTTP 解析，业务全部在此层。

import { DateTime } from 'luxon'
import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityScenario from '#models/resource_capacity_scenario'
import ResourceCapacitySimulationSnapshot from '#models/resource_capacity_simulation_snapshot'
import ResourceCapacitySelection from '#models/resource_capacity_selection'
import ResourceCapacityHandoffReceipt from '#models/resource_capacity_handoff_receipt'
import ResourceCapacityObservationSnapshot from '#models/resource_capacity_observation_snapshot'
import ResourceCapacityReview from '#models/resource_capacity_review'
import ResourceCapacityScenarioService from './scenario_service.js'
import ResourceCapacitySimulationService from './simulation_service.js'
import ResourceCapacitySelectionService from './selection_service.js'
import ResourceCapacityHandoffService, { type RcclDownstreamAdapter } from './handoff_service.js'
import ResourceCapacityObservationService from './observation_service.js'
import ResourceCapacityReviewService from './review_service.js'
import { buildRcclAuditRecord } from './audit_writer.js'
import { isResourceCapacityLoopEnabled } from '#services/resource_capacity_feature_flag'

/** 默认 no-op 下游 adapter：生产装配由 DI 工厂替换（见后续接线任务）。 */
const noopDownstream: RcclDownstreamAdapter = {
  async createAllocationDraft() {
    throw new Error('下游跨项目调配 adapter 尚未装配')
  },
  async createSuggestionPreview() {
    throw new Error('下游资源建议 preview adapter 尚未装配')
  },
}

export default class ResourceCapacityWorkbenchService {
  readonly scenarios = new ResourceCapacityScenarioService()
  readonly simulation = new ResourceCapacitySimulationService()
  readonly selection = new ResourceCapacitySelectionService()
  readonly review = new ResourceCapacityReviewService()
  handoff: ResourceCapacityHandoffService
  observation: ResourceCapacityObservationService

  constructor(downstream: RcclDownstreamAdapter = noopDownstream) {
    this.handoff = new ResourceCapacityHandoffService(downstream)
    this.observation = new ResourceCapacityObservationService(async () => [])
  }

  isFeatureEnabled(): boolean {
    return isResourceCapacityLoopEnabled()
  }

  async list(organizationId: number, query: { page?: number; perPage?: number; state?: string }) {
    const page = query.page ?? 1
    const perPage = Math.min(query.perPage ?? 20, 50)
    const qb = ResourceCapacityLoop.query().where('organization_id', organizationId)
    if (query.state) qb.where('state', query.state)
    const totalRows = await qb.clone().count('* as total')
    const total = Number(totalRows[0]?.$extras?.total ?? 0)
    const rows = await qb.orderBy('created_at', 'desc').forPage(page, perPage)
    return {
      data: rows.map((l) => ({
        id: l.id,
        title: l.title,
        ownerUserId: l.ownerUserId,
        state: l.state,
        revision: l.rowVersion,
        granularity: l.granularity,
        windowStart: l.windowStart,
        windowEnd: l.windowEnd,
        createdAt: l.createdAt.toISO(),
        updatedAt: l.updatedAt?.toISO() ?? null,
      })),
      meta: { total, page, perPage, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 },
    }
  }

  async create(input: {
    organizationId: number
    actorUserId: number
    title: string
    granularity: 'day' | 'week' | 'month'
    windowStart: string
    windowEnd: string
    projectIds: number[]
  }) {
    const loop = await ResourceCapacityLoop.create({
      organizationId: input.organizationId,
      ownerUserId: input.actorUserId,
      title: input.title,
      state: 'draft',
      granularity: input.granularity,
      windowStart: input.windowStart.slice(0, 10),
      windowEnd: input.windowEnd.slice(0, 10),
      rowVersion: 1,
      featureVersion: 'resource-capacity-loop@1',
    })
    buildRcclAuditRecord({
      event: 'loop_created',
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      refs: { loop_id: loop.id },
      toState: 'draft',
    })
    return loop
  }

  async detail(organizationId: number, loopId: number) {
    const loop = await ResourceCapacityLoop.query()
      .where('organization_id', organizationId)
      .where('id', loopId)
      .first()
    if (!loop) return null
    const [baseline] = await Promise.all([
      ResourceCapacityBaselineSnapshot.query()
        .where('organization_id', organizationId)
        .where('loop_id', loopId)
        .whereNull('superseded_by_id')
        .orderBy('created_at', 'desc')
        .first(),
    ])
    const [scenarios, simulations, selections, receipts, observations, reviews] = await Promise.all(
      [
        ResourceCapacityScenario.query()
          .where('organization_id', organizationId)
          .where('loop_id', loopId)
          .orderBy('id', 'asc'),
        ResourceCapacitySimulationSnapshot.query()
          .where('organization_id', organizationId)
          .where('loop_id', loopId)
          .orderBy('created_at', 'desc'),
        ResourceCapacitySelection.query()
          .where('organization_id', organizationId)
          .where('loop_id', loopId)
          .orderBy('created_at', 'desc')
          .limit(1),
        ResourceCapacityHandoffReceipt.query()
          .where('organization_id', organizationId)
          .where('loop_id', loopId)
          .orderBy('created_at', 'desc')
          .limit(5),
        ResourceCapacityObservationSnapshot.query()
          .where('organization_id', organizationId)
          .where('loop_id', loopId)
          .orderBy('created_at', 'desc')
          .limit(10),
        ResourceCapacityReview.query()
          .where('organization_id', organizationId)
          .where('loop_id', loopId)
          .orderBy('created_at', 'desc')
          .limit(5),
      ],
    )
    const latestSelection = selections[0] ?? null
    return {
      loop: {
        id: loop.id,
        title: loop.title,
        state: loop.state,
        revision: loop.rowVersion,
        granularity: loop.granularity,
        windowStart: loop.windowStart,
        windowEnd: loop.windowEnd,
      },
      baseline: baseline
        ? {
            id: baseline.id,
            digest: baseline.baselineDigest,
            readyForSimulation: baseline.readyForSimulation,
          }
        : null,
      scenarios: scenarios.map((s) => ({
        id: s.id,
        name: s.name,
        revision: s.rowVersion,
        active: s.active,
      })),
      simulations: simulations.map((s) => ({
        id: s.id,
        scenarioId: s.scenarioId,
        digest: s.simulationDigest,
        staleState: s.staleState,
      })),
      currentSelection: latestSelection
        ? {
            id: latestSelection.id,
            scenarioId: latestSelection.scenarioId,
            fingerprint: latestSelection.selectionFingerprint,
            expiresAt: latestSelection.expiresAt.toISO(),
          }
        : null,
      receipts: receipts.map((r) => ({ id: r.id, target: r.target, status: r.status })),
      observations: observations.map((o) => ({
        id: o.id,
        comparable: o.comparable,
        status: o.downstreamStatus,
      })),
      reviews: reviews.map((r) => ({ id: r.id, outcome: r.outcome })),
      // 下游二次确认姿态：闭环永不持有 confirm 句柄。
      actionPosture: {
        writesApplied: false as const,
        confirmationRequired: true as const,
      },
    }
  }

  /** baseline refresh 占位编排：Phase 4 collector 的生产接线点（当前返回明确降级）。 */
  async refreshBaseline(organizationId: number, loopId: number, actorUserId: number) {
    await ResourceCapacityLoop.query()
      .where('organization_id', organizationId)
      .where('id', loopId)
      .firstOrFail()
    buildRcclAuditRecord({
      event: 'baseline_refreshed',
      organizationId,
      actorUserId,
      refs: { loop_id: loopId },
      reasonCodes: ['RCCL_SOURCE_REQUIRED_FAILED'],
    })
    return {
      refreshed: false as const,
      degradedReason: 'RCCL_SOURCE_REQUIRED_FAILED' as const,
      detail: '基线刷新的生产来源接线将在 Service 层装配（见 default_readers），当前显式降级。',
    }
  }

  nowIso(): string {
    return DateTime.now().toISO()
  }
}
