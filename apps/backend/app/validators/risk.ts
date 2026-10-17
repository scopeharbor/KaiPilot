import vine from '@vinejs/vine'

const riskCategory = () =>
  vine.enum([
    'technical',
    'schedule',
    'cost',
    'resource',
    'external',
    'organizational',
    'legal',
    'other',
  ] as const)

const riskStatus = () =>
  vine.enum(['identified', 'analyzing', 'mitigating', 'resolved', 'accepted', 'closed'] as const)

const riskLevel = () => vine.enum(['low', 'medium', 'high', 'critical'] as const)

const probabilityImpact = () => vine.number().withoutDecimals().range([1, 5])

const aiMarkerValidator = vine.object({
  confidence: vine.number().range([0, 1]),
  source: vine.enum(['inferred', 'explicit', 'default'] as const),
  reason: vine.string().trim().minLength(1).maxLength(1000),
  needsConfirmation: vine.boolean(),
})

export const createRiskValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().minLength(1).maxLength(5000),
    category: riskCategory().optional(),
    probability: probabilityImpact().optional(),
    impact: probabilityImpact().optional(),
    ownerId: vine.number().withoutDecimals().positive().nullable().optional(),
    mitigationStrategy: vine.string().trim().maxLength(5000).nullable().optional(),
    contingencyPlan: vine.string().trim().maxLength(5000).nullable().optional(),
    triggerEvent: vine.string().trim().maxLength(255).nullable().optional(),
    residualProbability: probabilityImpact().nullable().optional(),
    residualImpact: probabilityImpact().nullable().optional(),
    targetResolutionDate: vine.string().trim().nullable().optional(),
    relatedTaskId: vine.number().withoutDecimals().positive().nullable().optional(),
    riskCode: vine.string().trim().maxLength(50).nullable().optional(),
    // V2 扩展
    priority: vine.enum(['low', 'medium', 'high', 'critical', 'normal'] as const).optional(),
    triggerCondition: vine.string().trim().maxLength(2000).nullable().optional(),
    nextReviewAt: vine.string().trim().nullable().optional(),
    source: vine.enum(['manual', 'ai_suggestion', 'ai_draft', 'rule_engine'] as const).optional(),
    // AI 来源字段
    aiMetadata: vine
      .object({
        aiMarker: aiMarkerValidator.optional(),
        suggestionBatchId: vine.string().trim().maxLength(64).optional(),
        sourceDraftId: vine.string().trim().maxLength(64).optional(),
        sourceDraftVersion: vine.number().withoutDecimals().optional(),
        promptVersion: vine.string().trim().maxLength(64).optional(),
      })
      .nullable()
      .optional(),
  }),
)

export const updateRiskValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255).optional(),
    description: vine.string().trim().minLength(1).maxLength(5000).optional(),
    category: riskCategory().optional(),
    probability: probabilityImpact().optional(),
    impact: probabilityImpact().optional(),
    ownerId: vine.number().withoutDecimals().positive().nullable().optional(),
    mitigationStrategy: vine.string().trim().maxLength(5000).nullable().optional(),
    contingencyPlan: vine.string().trim().maxLength(5000).nullable().optional(),
    triggerEvent: vine.string().trim().maxLength(255).nullable().optional(),
    residualProbability: probabilityImpact().nullable().optional(),
    residualImpact: probabilityImpact().nullable().optional(),
    targetResolutionDate: vine.string().trim().nullable().optional(),
    relatedTaskId: vine.number().withoutDecimals().positive().nullable().optional(),
    riskCode: vine.string().trim().maxLength(50).nullable().optional(),
    // V2 扩展
    priority: vine.enum(['low', 'medium', 'high', 'critical', 'normal'] as const).optional(),
    triggerCondition: vine.string().trim().maxLength(2000).nullable().optional(),
    nextReviewAt: vine.string().trim().nullable().optional(),
    closedReason: vine
      .enum(['resolved', 'accepted', 'mitigated', 'obsolete', 'transferred', 'other'] as const)
      .nullable()
      .optional(),
    closedNotes: vine.string().trim().maxLength(2000).nullable().optional(),
  }),
)

export const transitionRiskStatusValidator = vine.compile(
  vine.object({
    status: riskStatus(),
  }),
)

export const matrixQueryValidator = vine.compile(
  vine.object({
    basis: vine.enum(['inherent', 'residual'] as const).optional(),
  }),
)

export const listRisksValidator = vine.compile(
  vine.object({
    category: riskCategory().optional(),
    status: riskStatus().optional(),
    riskLevel: riskLevel().optional(),
    priority: vine.enum(['low', 'medium', 'high', 'critical', 'normal'] as const).optional(),
    ownerId: vine.number().withoutDecimals().positive().optional(),
    minScore: vine.number().withoutDecimals().range([1, 25]).optional(),
    maxScore: vine.number().withoutDecimals().range([1, 25]).optional(),
    search: vine.string().trim().maxLength(255).optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
    // V2 筛选
    reviewStatus: vine.enum(['overdue', 'upcoming', 'none'] as const).optional(),
    closedReason: vine
      .enum(['resolved', 'accepted', 'mitigated', 'obsolete', 'transferred', 'other'] as const)
      .optional(),
    responseStatus: vine.enum(['has_plans', 'no_plans'] as const).optional(),
  }),
)

export const aiSuggestTriggerValidator = vine.compile(vine.object({}))

export const acceptAiSuggestionValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().minLength(1).maxLength(5000),
    category: riskCategory(),
    probability: probabilityImpact(),
    impact: probabilityImpact(),
    mitigation: vine.string().trim().maxLength(5000).nullable().optional(),
    ownerId: vine.number().withoutDecimals().positive().nullable().optional(),
    relatedTaskId: vine.number().withoutDecimals().positive().nullable().optional(),
    aiMarker: aiMarkerValidator,
    suggestionBatchId: vine.string().trim().minLength(1).maxLength(64),
    modifiedByUser: vine.boolean().optional(),
  }),
)

// V2 新增验证器

export const createRiskMatrixConfigValidator = vine.compile(
  vine.object({
    probabilityLevels: vine.number().withoutDecimals().range([2, 10]).optional(),
    impactLevels: vine.number().withoutDecimals().range([2, 10]).optional(),
    zones: vine
      .array(
        vine.object({
          name: vine.string().trim().minLength(1).maxLength(40),
          probabilityFrom: vine.number().withoutDecimals().range([1, 10]),
          probabilityTo: vine.number().withoutDecimals().range([1, 10]),
          impactFrom: vine.number().withoutDecimals().range([1, 10]),
          impactTo: vine.number().withoutDecimals().range([1, 10]),
          color: vine.string().trim().maxLength(20),
          level: vine.enum(['low', 'medium', 'high', 'critical'] as const),
        }),
      )
      .optional(),
    defaultBasis: vine.enum(['inherent', 'residual'] as const).optional(),
    cellLimit: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)

export const createResponsePlanValidator = vine.compile(
  vine.object({
    strategyType: vine.enum([
      'avoid',
      'mitigate',
      'transfer',
      'accept',
      'contingency',
      'escalate',
    ] as const),
    actionDescription: vine.string().trim().minLength(1).maxLength(5000),
    ownerId: vine.number().withoutDecimals().positive().nullable().optional(),
    targetDate: vine.string().trim().nullable().optional(),
    relatedTaskId: vine.number().withoutDecimals().positive().nullable().optional(),
  }),
)

export const updateResponsePlanValidator = vine.compile(
  vine.object({
    strategyType: vine
      .enum(['avoid', 'mitigate', 'transfer', 'accept', 'contingency', 'escalate'] as const)
      .optional(),
    actionDescription: vine.string().trim().maxLength(5000).optional(),
    ownerId: vine.number().withoutDecimals().positive().nullable().optional(),
    targetDate: vine.string().trim().nullable().optional(),
    status: vine
      .enum(['planned', 'in_progress', 'completed', 'cancelled', 'overdue'] as const)
      .optional(),
    completionEvidence: vine.string().trim().maxLength(5000).nullable().optional(),
    relatedTaskId: vine.number().withoutDecimals().positive().nullable().optional(),
  }),
)

export const reviewRiskValidator = vine.compile(
  vine.object({
    conclusion: vine.string().trim().minLength(1).maxLength(2000),
    nextAction: vine.string().trim().minLength(1).maxLength(2000),
    nextReviewAt: vine.string().trim().nullable().optional(),
    notes: vine.string().trim().maxLength(5000).nullable().optional(),
  }),
)

export const evaluateCandidatesValidator = vine.compile(
  vine.object({
    rules: vine.array(vine.string().trim().minLength(1).maxLength(80)).optional(),
  }),
)

export const acceptCandidateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255).optional(),
    description: vine.string().trim().minLength(1).maxLength(5000).optional(),
    category: riskCategory().optional(),
    probability: probabilityImpact().optional(),
    impact: probabilityImpact().optional(),
    ownerId: vine.number().withoutDecimals().positive().nullable().optional(),
  }),
)

export const createKnowledgeTemplateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().minLength(1).maxLength(5000),
    category: riskCategory(),
    applicableProjectTypes: vine.array(vine.string().trim().maxLength(60)).nullable().optional(),
    triggerConditions: vine.any().nullable().optional(),
    suggestedProbability: probabilityImpact().nullable().optional(),
    suggestedImpact: probabilityImpact().nullable().optional(),
    suggestedResponse: vine.any().nullable().optional(),
    source: vine.string().trim().maxLength(100).optional(),
  }),
)
