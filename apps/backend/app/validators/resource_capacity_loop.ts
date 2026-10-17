// v3-resource-capacity-forecasting-closed-loop §7.1 —— 有界 Validator。
// 所有字段白名单化；数量/字节/日期窗口在读取与写入前约束（VALIDATION_ERROR 优先）。
import vine from '@vinejs/vine'
import { RESOURCE_CAPACITY_LOOP_BUDGETS } from '@aiproj/types'

export const resourceCapacityLoopParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    loopId: vine.number().positive().optional(),
    receiptId: vine.number().positive().optional(),
  }),
)

export const resourceCapacityLoopListQueryValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_PAGE_SIZE).optional(),
    state: vine
      .enum([
        'draft',
        'simulated',
        'selected',
        'handed-off',
        'observing',
        'reviewed',
        'closed',
        'cancelled',
      ])
      .optional(),
  }),
)

export const resourceCapacityLoopCreateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(200),
    granularity: vine.enum(['day', 'week', 'month']),
    windowStart: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    windowEnd: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    projectIds: vine
      .array(vine.number().positive())
      .maxLength(RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_PROJECT_SCOPE),
  }),
)

/** overlay 条目：kind 白名单 + 各自封闭字段（深度校验在 types 纯函数）。 */
export const overlayItemValidator = vine.object({
  kind: vine.enum(['project-scope', 'demand-shift', 'capacity-delta', 'allocation-preview-ref']),
})

export const resourceCapacityScenarioBodyValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(120),
    overlays: vine
      .array(overlayItemValidator)
      .maxLength(RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_OVERLAYS_PER_SCENARIO),
    expectedRevision: vine.number().positive(),
  }),
)

export const resourceCapacityScenarioParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    loopId: vine.number().positive(),
  }),
)

export const resourceCapacitySimulateValidator = vine.compile(
  vine.object({
    expectedRevision: vine.number().positive(),
  }),
)

export const resourceCapacitySelectValidator = vine.compile(
  vine.object({
    scenarioId: vine.number().positive(),
    simulationSnapshotId: vine.number().positive(),
    acknowledgedWarnings: vine.array(vine.string()).maxLength(20).optional(),
    actorType: vine.enum(['human_user']).optional(),
    currentPermissionFingerprint: vine.string().maxLength(64).optional(),
  }),
)

export const resourceCapacityHandoffValidator = vine.compile(
  vine.object({
    target: vine.enum([
      'cross-project-allocation-draft',
      'project-resource-suggestion-preview',
      'safe-navigation',
    ]),
    idempotencyKey: vine.string().trim().minLength(8).maxLength(120),
    requestedRefs: vine.array(vine.string().trim().maxLength(120)).maxLength(100),
    authorizedVisibleRefIds: vine.array(vine.string().trim().maxLength(120)).maxLength(1000),
    actorType: vine.enum(['human_user']).optional(),
  }),
)

export const resourceCapacityObservationValidator = vine.compile(
  vine.object({
    downstreamStatus: vine.enum([
      'confirmed_downstream',
      'applied_downstream',
      'partial',
      'failed',
      'cancelled',
      'expired',
    ]),
    appliedItemRefs: vine.array(vine.string().maxLength(120)).maxLength(500).optional(),
    failedItemRefs: vine.array(vine.string().maxLength(120)).maxLength(500).optional(),
    unrelatedChangeNotes: vine.array(vine.string().maxLength(300)).maxLength(50).optional(),
  }),
)

export const resourceCapacityReviewValidator = vine.compile(
  vine.object({
    observationSnapshotId: vine.number().positive(),
    outcome: vine.enum(['goal_met', 'partially_met', 'not_met', 'invalidated']),
    boundedRationale: vine.string().trim().maxLength(500),
    acknowledgedWarnings: vine.array(vine.string()).maxLength(20).optional(),
    actorType: vine.enum(['human_user']).optional(),
  }),
)

export const resourceCapacityCloseValidator = vine.compile(
  vine.object({
    expectedRevision: vine.number().positive(),
    actorType: vine.enum(['human_user']).optional(),
  }),
)

export const resourceCapacityCancelValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().maxLength(200).optional(),
    actorType: vine.enum(['human_user']).optional(),
  }),
)
