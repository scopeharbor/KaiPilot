import vine from '@vinejs/vine'

/**
 * TRIZ 资源分析器 Vine 验证器（v3-triz-resource-analyzer §5.1）。
 */

const manualResourceDraftSchema = vine.object({
  label: vine.string().trim().minLength(1).maxLength(200),
  resourceKind: vine.enum([
    'human',
    'technical',
    'information',
    'time',
    'space',
    'financial',
    'environmental',
    'functional',
    'material',
    'field',
  ]),
  systemScope: vine.enum(['internal_system', 'subsystem', 'supersystem', 'external_environment']),
  origin: vine.literal('user_supplied'),
  availability: vine.enum(['high', 'medium', 'low', 'none', 'unknown']),
  utilizationState: vine.enum([
    'fully_utilized',
    'partially_utilized',
    'idle',
    'overloaded',
    'unavailable',
    'unknown',
  ]),
  capacity: vine.string().maxLength(255).optional(),
  costRating: vine.enum(['low', 'medium', 'high', 'unknown']),
  description: vine.string().trim().maxLength(1000),
})

export const createResourceAnalysisValidator = vine.compile(
  vine.object({
    manualResourceDrafts: vine.array(manualResourceDraftSchema).maxLength(50).optional(),
    userContext: vine.string().trim().maxLength(2000).optional(),
    idempotencyKey: vine.string().trim().maxLength(80).optional(),
  }),
)

export const listResourceAnalysesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine
      .enum(['queued', 'completed', 'completed_with_warnings', 'failed', 'stale', 'archived'])
      .optional(),
    sort: vine.string().trim().maxLength(50).optional(),
  }),
)

export const listResourceSnapshotsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    resourceKind: vine
      .enum([
        'human',
        'technical',
        'information',
        'time',
        'space',
        'financial',
        'environmental',
        'functional',
        'material',
        'field',
      ])
      .optional(),
    systemScope: vine
      .enum(['internal_system', 'subsystem', 'supersystem', 'external_environment'])
      .optional(),
    origin: vine
      .enum([
        'project_registry',
        'organization_pool',
        'task_assignment',
        'risk_register',
        'knowledge_base',
        'compiler_triz',
        'function_analysis',
        'ifr_analysis',
        'workbench',
        'decision_log',
        'user_supplied',
      ])
      .optional(),
    sort: vine.string().trim().maxLength(50).optional(),
  }),
)

export const listResourceOpportunitiesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine
      .enum(['unreviewed', 'reviewed', 'previewed', 'blocked_stale', 'dismissed'])
      .optional(),
    opportunityType: vine
      .enum([
        'idle_capacity',
        'substitute_resource',
        'reuse_existing_asset',
        'external_low_cost_resource',
        'information_gap',
        'automation_opportunity',
        'overload_relief',
        'environmental_resource',
        'constraint_as_resource',
      ])
      .optional(),
    severity: vine.enum(['critical', 'high', 'medium', 'low']).optional(),
    stale: vine.boolean().optional(),
    sort: vine.string().trim().maxLength(50).optional(),
  }),
)

export const reviewResourceOpportunityValidator = vine.compile(
  vine.object({
    action: vine.enum(['mark_reviewed', 'mark_unreviewed', 'dismiss']),
    reason: vine.string().trim().maxLength(2000).optional(),
  }),
)

export const explainResourceOpportunityValidator = vine.compile(
  vine.object({
    // 可选字段，留给未来的 AI 配置
    provider: vine.string().trim().maxLength(50).optional(),
    model: vine.string().trim().maxLength(50).optional(),
  }),
)
