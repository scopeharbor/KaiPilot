/**
 * TRIZ Skill Layer validators (v3-triz-skill-layer-integration §3.4)
 *
 * Vine 验证器：summary filters、destination filters、route preview input、
 * handoff preview input、source hashes 和 idempotency keys。
 */
import vine from '@vinejs/vine'

// ── Summary filter constants ─────────────────────────────────────────
const logicalStageValues = [
  'requirements_parsing',
  'contradiction_detection',
  'solution_design',
  'architecture_definition',
  'task_execution',
  'monitoring_review',
  'change_management',
] as const

const availabilityValues = [
  'available',
  'advisory',
  'unavailable',
  'feature_off',
  'stale',
  'permission_denied',
  'missing_module',
] as const

// ── Summary query ────────────────────────────────────────────────────
export const trizSkillLayerSummaryQueryValidator = vine.compile(
  vine.object({
    stage: vine.enum(logicalStageValues).optional(),
    includeSources: vine.boolean().optional(),
  }),
)

// ── Destinations query ───────────────────────────────────────────────
export const trizSkillLayerDestinationsQueryValidator = vine.compile(
  vine.object({
    stage: vine.enum(logicalStageValues).optional(),
    availability: vine.enum(availabilityValues).optional(),
    sort: vine.string().optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

// ── Route preview input ──────────────────────────────────────────────
export const trizSkillLayerRoutePreviewValidator = vine.compile(
  vine.object({
    stageHint: vine.string().maxLength(256).optional(),
    userIntent: vine.string().maxLength(1024).optional(),
    selectedSourceHashes: vine.array(vine.string().maxLength(256)).maxLength(50).optional(),
    idempotencyKey: vine.string().maxLength(256),
    currentSourceHashes: vine.record(vine.string().maxLength(64)).optional(),
  }),
)

// ── Handoff preview input ────────────────────────────────────────────
export const trizSkillLayerHandoffPreviewValidator = vine.compile(
  vine.object({
    destinationKey: vine.string().maxLength(128),
    actionId: vine.string().maxLength(128),
    idempotencyKey: vine.string().maxLength(256),
    currentSourceHashes: vine.record(vine.string().maxLength(64)).optional(),
    previewContext: vine.enum(['route', 'direct', 'from_assistant']).optional(),
  }),
)
