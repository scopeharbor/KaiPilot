import vine from '@vinejs/vine'

/**
 * TRIZ 进化趋势分析 Vine 验证器（v3-triz-evolution-trend-analysis §5.1）。
 */

const manualTrendSignalSchema = vine.object({
  trendId: vine
    .enum([
      'completeness',
      'energy_information_transmission',
      'dynamization',
      'uneven_subsystem_evolution',
      'transition_to_supersystem',
      'micro_level_transition',
      'ideality_increase',
      'coordination',
    ])
    .optional(),
  direction: vine.enum(['improving', 'stable', 'declining', 'unknown']),
  signal: vine.string().trim().minLength(1).maxLength(2000),
  sourceNote: vine.string().trim().maxLength(500).optional(),
})

export const createEvolutionTrendAnalysisValidator = vine.compile(
  vine.object({
    scopeType: vine.enum(['project', 'subsystem', 'technology_stack', 'custom']).optional(),
    manualTrendSignals: vine.array(manualTrendSignalSchema).maxLength(50).optional(),
    userContext: vine.string().trim().maxLength(2000).optional(),
    idempotencyKey: vine.string().trim().maxLength(80).optional(),
  }),
)

export const listEvolutionTrendAnalysesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine
      .enum(['queued', 'completed', 'completed_with_warnings', 'failed', 'stale', 'archived'])
      .optional(),
    scopeType: vine.enum(['project', 'subsystem', 'technology_stack', 'custom']).optional(),
    sort: vine.string().trim().maxLength(50).optional(),
  }),
)

export const listTrendScoresValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(50).optional(),
    trendId: vine
      .enum([
        'completeness',
        'energy_information_transmission',
        'dynamization',
        'uneven_subsystem_evolution',
        'transition_to_supersystem',
        'micro_level_transition',
        'ideality_increase',
        'coordination',
      ])
      .optional(),
    severity: vine.enum(['critical', 'high', 'medium', 'low']).optional(),
    sort: vine.string().trim().maxLength(50).optional(),
  }),
)

export const listTrendRisksValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(50).optional(),
    status: vine
      .enum(['unreviewed', 'reviewed', 'previewed', 'blocked_stale', 'dismissed'])
      .optional(),
    riskType: vine
      .enum([
        'role_gap',
        'information_flow_delay',
        'process_rigidity',
        'subsystem_imbalance',
        'external_dependency_bottleneck',
        'complexity_granularity_risk',
        'ideality_decline',
        'coordination_drift',
      ])
      .optional(),
    trendId: vine
      .enum([
        'completeness',
        'energy_information_transmission',
        'dynamization',
        'uneven_subsystem_evolution',
        'transition_to_supersystem',
        'micro_level_transition',
        'ideality_increase',
        'coordination',
      ])
      .optional(),
    severity: vine.enum(['critical', 'high', 'medium', 'low']).optional(),
    stale: vine.boolean().optional(),
    sort: vine.string().trim().maxLength(50).optional(),
  }),
)

export const historyComparisonValidator = vine.compile(
  vine.object({
    baselineRunId: vine.number().min(1).optional(),
  }),
)

export const reviewTrendRiskValidator = vine.compile(
  vine.object({
    action: vine.enum(['mark_reviewed', 'mark_unreviewed', 'dismiss']),
    reason: vine.string().trim().maxLength(2000).optional(),
  }),
)

export const explainTrendRiskValidator = vine.compile(
  vine.object({
    provider: vine.string().trim().maxLength(50).optional(),
    model: vine.string().trim().maxLength(50).optional(),
  }),
)

export const handoffPreviewValidator = vine.compile(
  vine.object({
    currentSourceHashes: vine.record(vine.string()).optional(),
  }),
)
