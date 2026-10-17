import vine from '@vinejs/vine'

export const detectionPlanValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    scope: vine.object({
      organizationId: vine.number().positive(),
      projectIds: vine.array(vine.number().positive()).optional(),
      dateWindowStart: vine.string().optional(),
      dateWindowEnd: vine.string().optional(),
      maxProjects: vine.number().positive().max(500).optional(),
      maxEdges: vine.number().positive().max(20000).optional(),
      maxTasksPerProject: vine.number().positive().max(2000).optional(),
      ruleSetKey: vine.string().trim().maxLength(50).optional(),
      metadata: vine.any().optional(),
    }),
  }),
)

export const detectionRunValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    planToken: vine.string().trim().maxLength(256),
  }),
)

export const detectionListRunsValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    status: vine.string().optional(),
    sort: vine.string().trim().maxLength(100).optional(),
  }),
)

export const detectionListResultsValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    runId: vine.number().positive().optional(),
    severity: vine.string().optional(),
    confidence: vine.string().optional(),
    status: vine.string().optional(),
    ruleId: vine.string().optional(),
    dateFrom: vine.string().optional(),
    dateTo: vine.string().optional(),
    sort: vine.string().trim().maxLength(100).optional(),
  }),
)

export const detectionIgnoreValidator = vine.compile(
  vine.object({
    reasonHash: vine.string().trim().maxLength(64).optional(),
  }),
)

export const detectionReopenValidator = vine.compile(
  vine.object({
    reasonHash: vine.string().trim().maxLength(64).optional(),
  }),
)

export const detectionDraftBridgeValidator = vine.compile(
  vine.object({
    resultId: vine.number().positive(),
  }),
)
